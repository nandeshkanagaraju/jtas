/**
 * Attachments (build spec M10.2).
 *
 * Three steps, because the bytes never pass through this process:
 *
 *   1. `presignUpload` — the server decides the storage key and checks what it
 *      can know from the name, the declared type and the declared size
 *   2. the browser PUTs the file straight to the bucket
 *   3. `registerUpload` — the server reads the object's first bytes back and
 *      checks that the file is what it claimed to be
 *
 * Step 3 is the one that catches an `.exe` renamed to `.pdf`: the extension is
 * allowed, the declared type matches it, and only the bytes disagree. It is
 * also the first moment the server can see them, which is why the check lives
 * after the upload rather than before it.
 *
 * Nothing is hard-deleted (architecture rule 6). A drawing removed from a job
 * is part of why the job was built the way it was.
 */
import { prisma } from '@/lib/db/prisma';
import {
  CONTENT_PROBE_BYTES,
  checkDeclaredFile,
  checkFileContents,
  extensionOf,
  kindFor,
  storageKeyFor,
} from '@/lib/domain/file-types';
import { conflict, notFound, validationError } from '@/lib/errors';
import { writeAudit } from '@/lib/services/audit-service';
import {
  DOWNLOAD_URL_TTL_SECONDS,
  deleteObject,
  headObject,
  presignDownload,
  presignUpload,
  putObject,
  readHead,
} from '@/lib/storage/s3';
import { moduleLogger } from '@/lib/utils/logger';

const log = moduleLogger('attachments');

export interface AttachmentActor {
  id: string;
}

export interface AttachmentContext {
  ipAddress: string | null;
  /** WEB unless the file arrived from a linked Telegram chat. */
  source?: 'WEB' | 'TELEGRAM';
}

export interface AttachmentRow {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
  jobId: string | null;
  subtaskId: string | null;
  uploadedBy: { id: string; name: string } | null;
  /** True for types the UI can show a thumbnail of. */
  previewable: boolean;
  label: string;
}

export interface PresignInput {
  jobId: string;
  subtaskId?: string | null;
  fileName: string;
  contentType: string;
  sizeBytes: number;
}

export interface PresignResult {
  /** The row id, reserved now so the storage key can be built from it. */
  attachmentId: string;
  uploadUrl: string;
  storageKey: string;
  expiresInSeconds: number;
}

/**
 * Reserves an id and returns a URL the browser may PUT one object to.
 *
 * The id is generated here so the key can contain it. Nothing is written to the
 * database yet: an upload the user abandons should leave no row, and an object
 * with no row is invisible and eventually swept.
 */
export async function presignAttachment(input: PresignInput): Promise<PresignResult> {
  const declared = checkDeclaredFile({
    fileName: input.fileName,
    contentType: input.contentType,
    sizeBytes: input.sizeBytes,
  });

  if (!declared.ok) {
    throw validationError(declared.message ?? 'That file cannot be uploaded.', {
      reason: declared.reason,
      fields: { file: [declared.message ?? 'That file cannot be uploaded.'] },
    });
  }

  const job = await prisma.job.findUnique({
    where: { id: input.jobId },
    select: { id: true, status: true },
  });

  if (!job) throw notFound('Job');

  if (input.subtaskId) {
    const subtask = await prisma.subtask.findUnique({
      where: { id: input.subtaskId },
      select: { jobId: true },
    });

    if (!subtask) throw notFound('Subtask');

    // The job id is what builds the key, so a mismatch would file the object
    // under a job it does not belong to.
    if (subtask.jobId !== input.jobId) {
      throw validationError('That subtask is not part of that job.', {
        reason: 'SUBTASK_JOB_MISMATCH',
      });
    }
  }

  // A cuid, generated the same way Prisma would, so the key can be built before
  // the row exists.
  const attachmentId = `att_${crypto.randomUUID().replaceAll('-', '')}`;

  const storageKey = storageKeyFor({
    jobId: input.jobId,
    subtaskId: input.subtaskId ?? null,
    id: attachmentId,
    fileName: input.fileName,
  });

  const { url, expiresInSeconds } = await presignUpload({
    key: storageKey,
    contentType: input.contentType,
    sizeBytes: input.sizeBytes,
  });

  return { attachmentId, uploadUrl: url, storageKey, expiresInSeconds };
}

export interface RegisterInput {
  attachmentId: string;
  jobId: string;
  subtaskId?: string | null;
  fileName: string;
  contentType: string;
  storageKey: string;
}

/**
 * Registers an object that has finished uploading.
 *
 * Everything the client says is re-derived or re-checked here. The size comes
 * from the bucket, not from the request; the first bytes are read back and
 * matched against the extension; and the key is rebuilt from server-side ids
 * and compared, so a client cannot register somebody else's object as its own.
 */
export async function registerUpload(
  input: RegisterInput,
  actor: AttachmentActor,
  ctx: AttachmentContext,
): Promise<AttachmentRow> {
  const expectedKey = storageKeyFor({
    jobId: input.jobId,
    subtaskId: input.subtaskId ?? null,
    id: input.attachmentId,
    fileName: input.fileName,
  });

  if (input.storageKey !== expectedKey) {
    // The only way to reach this is by editing the request. Refuse rather than
    // trust it: the alternative is registering an arbitrary object in the
    // bucket — including another job's drawing — as this job's attachment.
    throw validationError('That upload does not match what was authorised.', {
      reason: 'STORAGE_KEY_MISMATCH',
    });
  }

  if (await prisma.attachment.findFirst({ where: { storageKey: expectedKey } })) {
    throw conflict('That file has already been registered.', { reason: 'ALREADY_REGISTERED' });
  }

  const facts = await headObject(expectedKey);

  if (!facts) {
    throw validationError('That upload did not arrive. Try again.', { reason: 'OBJECT_MISSING' });
  }

  // Size from the bucket, so a client cannot declare 1 KB and upload 30 MB.
  const declared = checkDeclaredFile({
    fileName: input.fileName,
    contentType: input.contentType,
    sizeBytes: facts.sizeBytes,
  });

  if (!declared.ok) {
    await deleteObject(expectedKey);
    throw validationError(declared.message ?? 'That file cannot be uploaded.', {
      reason: declared.reason,
    });
  }

  const head = await readHead(expectedKey, CONTENT_PROBE_BYTES);

  if (!head) {
    await deleteObject(expectedKey);
    throw validationError('That upload could not be read back.', { reason: 'OBJECT_UNREADABLE' });
  }

  const contents = checkFileContents(input.fileName, head);

  if (!contents.ok) {
    /*
     * The renamed-executable case. The object is removed rather than left in
     * the bucket: an unreferenced object nobody can reach is still an object
     * somebody uploaded on purpose.
     */
    log.warn(
      { fileName: input.fileName, actorId: actor.id, reason: contents.reason },
      'upload rejected: contents do not match the extension',
    );

    await deleteObject(expectedKey);

    throw validationError(contents.message ?? 'That file is not what it claims to be.', {
      reason: contents.reason,
    });
  }

  const kind = kindFor(extensionOf(input.fileName));

  const row = await prisma.$transaction(async (tx) => {
    const created = await tx.attachment.create({
      data: {
        id: input.attachmentId,
        jobId: input.jobId,
        subtaskId: input.subtaskId ?? null,
        fileName: input.fileName,
        storageKey: expectedKey,
        mimeType: kind?.mimeTypes[0] ?? input.contentType,
        sizeBytes: facts.sizeBytes,
        uploadedById: actor.id,
      },
    });

    await writeAudit(tx, {
      actorId: actor.id,
      action: 'ATTACHMENT_UPLOADED',
      entityType: input.subtaskId ? 'SUBTASK' : 'JOB',
      entityId: input.subtaskId ?? input.jobId,
      after: {
        attachmentId: created.id,
        fileName: created.fileName,
        sizeBytes: created.sizeBytes,
      },
      ipAddress: ctx.ipAddress,
      source: ctx.source ?? 'WEB',
    });

    return created;
  });

  return toRow(row, { id: actor.id, name: '' });
}

/**
 * Stores bytes this process already has, then registers them.
 *
 * Used when the file did not come from a browser: Telegram hands the bot the
 * object, and the same allow-list, size cap and magic-byte check still apply.
 * The check runs on these bytes and again when the object is read back, which
 * is the same second look a browser upload gets.
 */
export async function ingestAttachment(
  input: {
    jobId: string;
    subtaskId: string;
    fileName: string;
    contentType: string;
    bytes: Uint8Array;
  },
  actor: AttachmentActor,
  ctx: AttachmentContext,
): Promise<AttachmentRow> {
  const declared = checkDeclaredFile({
    fileName: input.fileName,
    contentType: input.contentType,
    sizeBytes: input.bytes.byteLength,
  });
  if (!declared.ok) {
    throw validationError(declared.message ?? 'That file cannot be uploaded.', {
      reason: declared.reason,
    });
  }

  const contents = checkFileContents(input.fileName, input.bytes);
  if (!contents.ok) {
    log.warn(
      { fileName: input.fileName, actorId: actor.id, reason: contents.reason },
      'upload rejected: contents do not match the extension',
    );
    throw validationError(contents.message ?? 'That file is not what it claims to be.', {
      reason: contents.reason,
    });
  }

  const reserved = await presignAttachment({
    jobId: input.jobId,
    subtaskId: input.subtaskId,
    fileName: input.fileName,
    contentType: input.contentType,
    sizeBytes: input.bytes.byteLength,
  });

  await putObject({
    key: reserved.storageKey,
    contentType: input.contentType,
    body: input.bytes,
  });

  return registerUpload(
    {
      attachmentId: reserved.attachmentId,
      jobId: input.jobId,
      subtaskId: input.subtaskId,
      fileName: input.fileName,
      contentType: input.contentType,
      storageKey: reserved.storageKey,
    },
    actor,
    ctx,
  );
}

/** Attachments on a job, on its subtasks, or on one subtask. */
export async function listAttachments(filter: {
  jobId?: string;
  subtaskId?: string;
  /** Job-level only — the customer drawing and the PO, not a subtask's files. */
  jobLevelOnly?: boolean;
}): Promise<AttachmentRow[]> {
  const rows = await prisma.attachment.findMany({
    where: {
      deletedAt: null,
      ...(filter.subtaskId ? { subtaskId: filter.subtaskId } : {}),
      ...(filter.jobId ? { jobId: filter.jobId } : {}),
      ...(filter.jobLevelOnly ? { subtaskId: null } : {}),
    },
    orderBy: { createdAt: 'desc' },
  });

  if (rows.length === 0) return [];

  const users = await prisma.user.findMany({
    where: { id: { in: [...new Set(rows.map((row) => row.uploadedById))] } },
    select: { id: true, name: true },
  });

  const byId = new Map(users.map((user) => [user.id, user]));

  return rows.map((row) => toRow(row, byId.get(row.uploadedById) ?? null));
}

/** One attachment, or null when it is gone or hidden. */
export async function getAttachment(id: string) {
  return prisma.attachment.findFirst({
    where: { id, deletedAt: null },
    select: {
      id: true,
      fileName: true,
      mimeType: true,
      storageKey: true,
      jobId: true,
      subtaskId: true,
    },
  });
}

/** A short-lived URL for reading one attachment. */
export async function attachmentUrl(
  id: string,
  options: { disposition?: 'inline' | 'attachment' } = {},
): Promise<{ url: string; expiresAt: string; expiresInSeconds: number; fileName: string }> {
  const attachment = await getAttachment(id);
  if (!attachment) throw notFound('Attachment');

  const signed = await presignDownload({
    key: attachment.storageKey,
    fileName: attachment.fileName,
    contentType: attachment.mimeType,
    disposition: options.disposition,
  });

  return { ...signed, fileName: attachment.fileName };
}

/**
 * Hides an attachment.
 *
 * The row and the object both stay. `ATTACHMENT_DELETED` in the audit log
 * records a hiding, not a removal — which is the honest word for what happened.
 */
export async function softDeleteAttachment(
  id: string,
  actor: AttachmentActor,
  ctx: AttachmentContext,
): Promise<void> {
  const attachment = await prisma.attachment.findFirst({
    where: { id, deletedAt: null },
    select: { id: true, fileName: true, jobId: true, subtaskId: true },
  });

  if (!attachment) throw notFound('Attachment');

  await prisma.$transaction(async (tx) => {
    await tx.attachment.update({
      where: { id },
      data: { deletedAt: new Date(), deletedById: actor.id },
    });

    await writeAudit(tx, {
      actorId: actor.id,
      action: 'ATTACHMENT_DELETED',
      entityType: attachment.subtaskId ? 'SUBTASK' : 'JOB',
      entityId: attachment.subtaskId ?? attachment.jobId ?? id,
      before: { attachmentId: id, fileName: attachment.fileName },
      ipAddress: ctx.ipAddress,
    });
  });
}

export { DOWNLOAD_URL_TTL_SECONDS };

interface Row {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: Date;
  jobId: string | null;
  subtaskId: string | null;
}

function toRow(row: Row, uploadedBy: { id: string; name: string } | null): AttachmentRow {
  const kind = kindFor(extensionOf(row.fileName));

  return {
    id: row.id,
    fileName: row.fileName,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    createdAt: row.createdAt.toISOString(),
    jobId: row.jobId,
    subtaskId: row.subtaskId,
    uploadedBy,
    previewable: kind?.previewable ?? false,
    label: kind?.label ?? 'File',
  };
}
