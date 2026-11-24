/**
 * POST /api/attachments/upload?jobId=…&subtaskId=… — same-origin upload.
 *
 * The browser sends the file's bytes here instead of PUTting them straight to
 * the bucket. Catalyst's Production environment keeps its own bucket CORS list
 * that can only change by promoting from Development, so a direct browser PUT
 * from the live origin is refused. Going through the app avoids CORS entirely:
 * this server stores the object itself, with the same allow-list, size cap,
 * magic-byte check and storage-key rules as every other upload path.
 *
 * Body: the raw file. Headers: Content-Type (the file's type) and
 * X-File-Name (URI-encoded original name).
 */
import { handler, ok } from '@/lib/api/respond';
import { assertCan, can } from '@/lib/auth/policy';
import { requireActiveSession } from '@/lib/auth/session';
import { forbidden, validationError } from '@/lib/errors';
import { MAX_ATTACHMENT_BYTES } from '@/lib/domain/file-types';
import { ingestAttachment } from '@/lib/services/attachment-service';
import { loadJobForWrite } from '@/lib/services/jobs';
import { getSubtask } from '@/lib/services/subtasks';
import { storageConfigured } from '@/lib/storage/s3';
import { clientIp } from '@/lib/utils/request';

import { subtaskResource } from '../../subtasks/subtask-resource';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function decodeName(raw: string | null): string {
  if (!raw) return '';
  try {
    return decodeURIComponent(raw).trim();
  } catch {
    return '';
  }
}

export const POST = handler(async (request) => {
  const session = await requireActiveSession();

  if (!storageConfigured()) {
    throw validationError('Attachment storage is not configured on this server.', {
      reason: 'STORAGE_NOT_CONFIGURED',
    });
  }

  const params = new URL(request.url).searchParams;
  const jobId = params.get('jobId')?.trim() ?? '';
  const subtaskId = params.get('subtaskId')?.trim() || null;
  const fileName = decodeName(request.headers.get('x-file-name'));
  const contentType = request.headers.get('content-type')?.split(';')[0]?.trim() || '';

  if (!jobId || !fileName || fileName.length > 255 || !contentType) {
    throw validationError('Say which job the file is for, and send the file with its name.', {
      reason: 'UPLOAD_INCOMPLETE',
    });
  }

  // Refuse an oversized body before reading it into memory.
  const declaredLength = Number(request.headers.get('content-length') ?? '0');
  if (declaredLength > MAX_ATTACHMENT_BYTES) {
    throw validationError('That file is larger than the attachment limit.', {
      reason: 'TOO_LARGE',
    });
  }

  // Same permission rules as presign + register.
  if (subtaskId) {
    const subtask = await getSubtask(session, subtaskId);
    assertCan(session, 'attachment:create', subtaskResource(subtask));
  } else {
    const job = await loadJobForWrite(jobId);
    const resource = { id: job.id, createdById: job.createdBy.id, participantIds: [] };
    if (!can(session, 'job:edit', resource)) throw forbidden();
  }

  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength === 0) {
    throw validationError('That file is empty.', { reason: 'EMPTY_FILE' });
  }

  const row = await ingestAttachment({ jobId, subtaskId, fileName, contentType, bytes }, session, {
    ipAddress: clientIp(request),
  });

  return ok({ data: row }, { status: 201 });
});
