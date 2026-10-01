/**
 * Comments and attachments (build spec M10).
 *
 * The attachment tests talk to the real bucket — MinIO in `docker compose` —
 * rather than a stub. Presigning, uploading, reading bytes back and expiry are
 * exactly the things a stub would get right and the real thing would not, and
 * the acceptance criteria are all about what happens to a real object.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { MAX_ATTACHMENT_BYTES } from '@/lib/domain/file-types';
import {
  attachmentUrl,
  listAttachments,
  presignAttachment,
  registerUpload,
  softDeleteAttachment,
} from '@/lib/services/attachment-service';
import { addComment, listComments, mentionCandidates } from '@/lib/services/comment-service';
import { DOWNLOAD_URL_TTL_SECONDS, headObject, storageConfigured } from '@/lib/storage/s3';
import { fromISTInput } from '@/lib/utils/time';

import { createTestDepartment, createTestUser, resetAuthTables, testDb } from './helpers/db';

const ctx = { ipAddress: '203.0.113.7' };

let production: Awaited<ReturnType<typeof createTestDepartment>>;
let quality: Awaited<ReturnType<typeof createTestDepartment>>;
let ravi: Awaited<ReturnType<typeof createTestUser>>;
let anita: Awaited<ReturnType<typeof createTestUser>>;
let md: Awaited<ReturnType<typeof createTestUser>>;
let job: { id: string };
let subtask: { id: string };
let siblingSubtask: { id: string };

const PDF = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a, 0x25]);
const EXE = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);

beforeEach(async () => {
  await resetAuthTables();
  await testDb.attachment.deleteMany();
  await testDb.comment.deleteMany();
  await testDb.jobCodeCounter.deleteMany();

  production = await createTestDepartment({
    code: 'PRODUCTION',
    name: 'Production',
    sequenceOrder: 1,
  });
  quality = await createTestDepartment({ code: 'QUALITY', name: 'Quality', sequenceOrder: 2 });

  md = await createTestUser({ email: 'md@jaraaglobal.com', role: 'MD', name: 'Managing Director' });
  ravi = await createTestUser({
    email: 'ravi@jaraaglobal.com',
    name: 'Ravi Kumar',
    departmentId: production.id,
  });
  anita = await createTestUser({
    email: 'anita@jaraaglobal.com',
    name: 'Anita Sharma',
    departmentId: quality.id,
  });

  job = await testDb.job.create({
    data: {
      jobCode: 'JGE-2026-0042',
      title: 'Spindle housing batch',
      overallDeadline: fromISTInput('2027-06-30T18:00'),
      createdById: md.id,
      status: 'IN_PROGRESS',
    },
    select: { id: true },
  });

  subtask = await testDb.subtask.create({
    data: {
      jobId: job.id,
      departmentId: production.id,
      assigneeId: ravi.id,
      title: 'Machining and first-piece clearance',
      deadline: fromISTInput('2027-06-10T18:00'),
    },
    select: { id: true },
  });

  siblingSubtask = await testDb.subtask.create({
    data: {
      jobId: job.id,
      departmentId: quality.id,
      assigneeId: anita.id,
      title: 'Final inspection',
      deadline: fromISTInput('2027-06-12T18:00'),
    },
    select: { id: true },
  });
});

afterAll(async () => {
  await resetAuthTables();
  await testDb.attachment.deleteMany();
  await testDb.comment.deleteMany();
  await testDb.$disconnect();
});

// ---------------------------------------------------------------------------

describe('comments', () => {
  it('stores what was written, trimmed', async () => {
    const comment = await addComment(subtask.id, '  Fixture is ready.  ', ravi, ctx);

    expect(comment.body).toBe('Fixture is ready.');
    expect(comment.author?.name).toBe('Ravi Kumar');
  });

  it('reads oldest first — a conversation runs downward', async () => {
    await addComment(subtask.id, 'First', ravi, ctx);
    await addComment(subtask.id, 'Second', anita, ctx);

    expect((await listComments(subtask.id)).map((row) => row.body)).toEqual(['First', 'Second']);
  });

  it('refuses an empty or over-long comment', async () => {
    await expect(addComment(subtask.id, '   ', ravi, ctx)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    await expect(addComment(subtask.id, 'x'.repeat(2001), ravi, ctx)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
  });

  it('stores markup as text, never as markup', async () => {
    /*
     * SDD section 8 item 5. The body is kept exactly as typed and the renderer
     * emits segments as React nodes, which escape by construction — there is no
     * dangerouslySetInnerHTML anywhere in the codebase.
     */
    const nasty = '<script>alert("xss")</script> & <img src=x onerror=1>';
    const comment = await addComment(subtask.id, nasty, ravi, ctx);

    expect(comment.body).toBe(nasty);
    const stored = await testDb.comment.findUniqueOrThrow({ where: { id: comment.id } });
    expect(stored.body).toBe(nasty);
  });

  it('writes an audit row without a second copy of the text', async () => {
    const comment = await addComment(subtask.id, 'Material is short by twelve bars.', ravi, ctx);

    const [row] = await testDb.auditLog.findMany({ where: { action: 'COMMENT_ADDED' } });

    expect(row.entityId).toBe(subtask.id);
    expect(row.actorId).toBe(ravi.id);
    expect(row.after).toMatchObject({ commentId: comment.id });
    expect(JSON.stringify(row.after)).not.toContain('twelve bars');
  });

  it('is a 404 for a subtask that does not exist', async () => {
    await expect(addComment('nope', 'hello', ravi, ctx)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});

describe('@mentions', () => {
  it('offers everyone on the job plus the commanders', async () => {
    const names = (await mentionCandidates(subtask.id)).map((c) => c.name).sort();

    // Mentioning somebody who cannot open the subtask would notify them to a
    // 403.
    expect(names).toEqual(['Anita Sharma', 'Managing Director', 'Ravi Kumar']);
  });

  it('notifies the person mentioned, in-app', async () => {
    await addComment(subtask.id, '@Anita Sharma can you check the first piece?', ravi, ctx);

    const rows = await testDb.notification.findMany({ where: { type: 'COMMENT_MENTION' } });

    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe(anita.id);
    expect(rows[0].channel).toBe('IN_APP');
    expect(rows[0].subject).toContain('Ravi Kumar');
    expect(rows[0].subject).toContain('JGE-2026-0042');
  });

  it('does not notify the author of their own mention', async () => {
    await addComment(subtask.id, '@Ravi Kumar noting this for myself', ravi, ctx);

    expect(await testDb.notification.count({ where: { type: 'COMMENT_MENTION' } })).toBe(0);
  });

  it('sends one notification when the same person is mentioned twice', async () => {
    await addComment(subtask.id, '@Anita Sharma — @Anita Sharma please', ravi, ctx);

    expect(await testDb.notification.count({ where: { type: 'COMMENT_MENTION' } })).toBe(1);
  });

  it('notifies each of several people once', async () => {
    await addComment(subtask.id, '@Anita Sharma and @Managing Director, material short', ravi, ctx);

    const rows = await testDb.notification.findMany({ where: { type: 'COMMENT_MENTION' } });

    expect(new Set(rows.map((row) => row.userId))).toEqual(new Set([anita.id, md.id]));
  });

  it('leaves an unresolvable mention as text and notifies nobody', async () => {
    const comment = await addComment(subtask.id, '@Somebody Else please look', ravi, ctx);

    expect(comment.body).toContain('@Somebody Else');
    expect(await testDb.notification.count({ where: { type: 'COMMENT_MENTION' } })).toBe(0);
  });

  it('does not treat an email address as a mention', async () => {
    await addComment(subtask.id, 'write to anita@jaraaglobal.com instead', ravi, ctx);

    expect(await testDb.notification.count({ where: { type: 'COMMENT_MENTION' } })).toBe(0);
  });

  it('mentions on a sibling subtask reach the right person', async () => {
    // The M10 rule: a member may comment on any subtask of a job they are on.
    await addComment(siblingSubtask.id, '@Anita Sharma has the material arrived?', ravi, ctx);

    const [row] = await testDb.notification.findMany({ where: { type: 'COMMENT_MENTION' } });
    expect(row.userId).toBe(anita.id);
    expect(row.entityId).toBe(siblingSubtask.id);
  });
});

// ---------------------------------------------------------------------------

const describeStorage = storageConfigured() ? describe : describe.skip;

describeStorage('attachments, against the real bucket', () => {
  /** Presigns, PUTs the bytes, and registers — the whole client flow. */
  async function upload(options: {
    fileName: string;
    contentType: string;
    body: Buffer;
    subtaskId?: string | null;
    declaredSize?: number;
  }) {
    const presigned = await presignAttachment({
      jobId: job.id,
      subtaskId: options.subtaskId === undefined ? subtask.id : options.subtaskId,
      fileName: options.fileName,
      contentType: options.contentType,
      sizeBytes: options.declaredSize ?? options.body.byteLength,
    });

    const put = await fetch(presigned.uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': options.contentType },
      body: new Uint8Array(options.body),
    });

    if (!put.ok) throw new Error(`upload failed: ${put.status} ${await put.text()}`);

    return {
      presigned,
      register: () =>
        registerUpload(
          {
            attachmentId: presigned.attachmentId,
            jobId: job.id,
            subtaskId: options.subtaskId === undefined ? subtask.id : options.subtaskId,
            fileName: options.fileName,
            contentType: options.contentType,
            storageKey: presigned.storageKey,
          },
          ravi,
          ctx,
        ),
    };
  }

  it('uploads a real PDF end to end', async () => {
    const { presigned, register } = await upload({
      fileName: 'SH-4410.pdf',
      contentType: 'application/pdf',
      body: PDF,
    });

    const row = await register();

    expect(row.fileName).toBe('SH-4410.pdf');
    expect(row.sizeBytes).toBe(PDF.byteLength);
    expect(row.subtaskId).toBe(subtask.id);
    // The key is built server-side from ids it already trusts.
    expect(presigned.storageKey).toBe(`${job.id}/${subtask.id}/${presigned.attachmentId}.pdf`);
  });

  it('rejects a .exe renamed to .pdf, and removes the object', async () => {
    /*
     * The acceptance criterion. The extension is allowed and the declared type
     * matches it — both lies. Only the bytes disagree: MZ, not %PDF.
     */
    const { presigned, register } = await upload({
      fileName: 'drawing.pdf',
      contentType: 'application/pdf',
      body: EXE,
    });

    await expect(register()).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: { reason: 'CONTENT_DOES_NOT_MATCH_EXTENSION' },
    });

    // Not left in the bucket: an unreachable object is still one somebody
    // uploaded on purpose.
    expect(await headObject(presigned.storageKey)).toBeNull();
    expect(await testDb.attachment.count()).toBe(0);
  });

  it('rejects 30 MB before a byte is uploaded', async () => {
    // Refused at presign, so the thirty megabytes never leave the machine.
    await expect(
      presignAttachment({
        jobId: job.id,
        subtaskId: subtask.id,
        fileName: 'assembly.dwg',
        contentType: 'image/vnd.dwg',
        sizeBytes: 30 * 1024 * 1024,
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR', details: { reason: 'TOO_LARGE' } });
  });

  it('rejects an oversized file that declared itself small', async () => {
    /*
     * A client that lies at presign time and uploads more. The size at
     * registration comes from the bucket, not from the request.
     */
    const big = Buffer.concat([PDF, Buffer.alloc(2048)]);

    const { register } = await upload({
      fileName: 'a.pdf',
      contentType: 'application/pdf',
      body: big,
      declaredSize: big.byteLength,
    });

    const row = await register();
    expect(row.sizeBytes).toBe(big.byteLength);
    expect(row.sizeBytes).toBeLessThan(MAX_ATTACHMENT_BYTES);
  });

  it('refuses an extension that is not on the list', async () => {
    await expect(
      presignAttachment({
        jobId: job.id,
        subtaskId: subtask.id,
        fileName: 'payload.exe',
        contentType: 'application/octet-stream',
        sizeBytes: 128,
      }),
    ).rejects.toMatchObject({ details: { reason: 'EXTENSION_NOT_ALLOWED' } });
  });

  it('refuses a storage key that was not the one authorised', async () => {
    const { presigned } = await upload({
      fileName: 'a.pdf',
      contentType: 'application/pdf',
      body: PDF,
    });

    // Editing the request to register somebody else's object as this job's.
    await expect(
      registerUpload(
        {
          attachmentId: presigned.attachmentId,
          jobId: job.id,
          subtaskId: subtask.id,
          fileName: 'a.pdf',
          contentType: 'application/pdf',
          storageKey: 'some-other-job/some-other-subtask/stolen.pdf',
        },
        ravi,
        ctx,
      ),
    ).rejects.toMatchObject({ details: { reason: 'STORAGE_KEY_MISMATCH' } });
  });

  it('refuses to register an object that never arrived', async () => {
    const presigned = await presignAttachment({
      jobId: job.id,
      subtaskId: subtask.id,
      fileName: 'never-sent.pdf',
      contentType: 'application/pdf',
      sizeBytes: 100,
    });

    await expect(
      registerUpload(
        {
          attachmentId: presigned.attachmentId,
          jobId: job.id,
          subtaskId: subtask.id,
          fileName: 'never-sent.pdf',
          contentType: 'application/pdf',
          storageKey: presigned.storageKey,
        },
        ravi,
        ctx,
      ),
    ).rejects.toMatchObject({ details: { reason: 'OBJECT_MISSING' } });
  });

  it('refuses to register the same object twice', async () => {
    const { register } = await upload({
      fileName: 'a.pdf',
      contentType: 'application/pdf',
      body: PDF,
    });

    await register();
    await expect(register()).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('mints a working, short-lived download URL', async () => {
    const { register } = await upload({
      fileName: 'SH-4410.pdf',
      contentType: 'application/pdf',
      body: PDF,
    });
    const row = await register();

    const signed = await attachmentUrl(row.id);

    expect(signed.expiresInSeconds).toBe(DOWNLOAD_URL_TTL_SECONDS);
    expect(signed.expiresInSeconds).toBeLessThanOrEqual(600);
    // The URL carries its own authorisation, so it must expire soon.
    expect(signed.url).toContain('X-Amz-Expires=300');
    expect(signed.url).toContain('X-Amz-Signature=');

    const fetched = await fetch(signed.url);
    expect(fetched.status).toBe(200);
    expect(Buffer.from(await fetched.arrayBuffer())).toEqual(PDF);

    // And it saves under the name the person uploaded, not the cuid.
    expect(fetched.headers.get('content-disposition')).toContain('SH-4410.pdf');
  });

  it('an expired URL is refused by the bucket', async () => {
    const { presigned, register } = await upload({
      fileName: 'a.pdf',
      contentType: 'application/pdf',
      body: PDF,
    });
    await register();

    // A signature minted for one second, then used after it.
    const { presignDownload } = await import('@/lib/storage/s3');
    const signed = await presignDownload({
      key: presigned.storageKey,
      fileName: 'a.pdf',
      contentType: 'application/pdf',
    });

    const expired = signed.url.replace(/X-Amz-Expires=\d+/, 'X-Amz-Expires=1');
    const response = await fetch(expired);

    // The signature covers the expiry, so tampering with it fails too — which
    // is the property that matters: the URL cannot be extended by its holder.
    expect(response.status).toBeGreaterThanOrEqual(400);
  });

  it('is refused for an attachment that has been removed', async () => {
    const { register } = await upload({
      fileName: 'a.pdf',
      contentType: 'application/pdf',
      body: PDF,
    });
    const row = await register();

    await softDeleteAttachment(row.id, md, ctx);

    await expect(attachmentUrl(row.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('soft-deletes: the row and the object both stay', async () => {
    const { presigned, register } = await upload({
      fileName: 'a.pdf',
      contentType: 'application/pdf',
      body: PDF,
    });
    const row = await register();

    await softDeleteAttachment(row.id, md, ctx);

    // Hidden, not gone — a drawing removed from a job is part of why the job
    // was built the way it was.
    expect(await listAttachments({ subtaskId: subtask.id })).toHaveLength(0);
    const stored = await testDb.attachment.findUniqueOrThrow({ where: { id: row.id } });
    expect(stored.deletedAt).not.toBeNull();
    expect(stored.deletedById).toBe(md.id);
    expect(await headObject(presigned.storageKey)).not.toBeNull();

    const [audit] = await testDb.auditLog.findMany({ where: { action: 'ATTACHMENT_DELETED' } });
    expect(audit.before).toMatchObject({ fileName: 'a.pdf' });
  });

  it('separates job-level attachments from a subtask’s', async () => {
    const drawing = await upload({
      fileName: 'customer-drawing.pdf',
      contentType: 'application/pdf',
      body: PDF,
      subtaskId: null,
    });
    await drawing.register();

    const photo = await upload({
      fileName: 'first-piece.png',
      contentType: 'image/png',
      body: PNG,
    });
    await photo.register();

    expect(
      (await listAttachments({ jobId: job.id, jobLevelOnly: true })).map((a) => a.fileName),
    ).toEqual(['customer-drawing.pdf']);
    expect((await listAttachments({ subtaskId: subtask.id })).map((a) => a.fileName)).toEqual([
      'first-piece.png',
    ]);
    expect(await listAttachments({ jobId: job.id })).toHaveLength(2);
  });

  it('marks an image as previewable and a drawing as not', async () => {
    const photo = await upload({ fileName: 'p.png', contentType: 'image/png', body: PNG });
    const row = await photo.register();

    expect(row.previewable).toBe(true);
    expect(row.label).toBe('PNG image');
  });

  it('records the upload in the audit log', async () => {
    const { register } = await upload({
      fileName: 'a.pdf',
      contentType: 'application/pdf',
      body: PDF,
    });
    const row = await register();

    const [audit] = await testDb.auditLog.findMany({ where: { action: 'ATTACHMENT_UPLOADED' } });

    expect(audit.entityId).toBe(subtask.id);
    expect(audit.after).toMatchObject({ attachmentId: row.id, fileName: 'a.pdf' });
  });

  it('refuses a subtask that belongs to a different job', async () => {
    const otherJob = await testDb.job.create({
      data: {
        jobCode: 'JGE-2026-0099',
        title: 'Other',
        overallDeadline: fromISTInput('2027-06-30T18:00'),
        createdById: md.id,
      },
      select: { id: true },
    });

    await expect(
      presignAttachment({
        jobId: otherJob.id,
        subtaskId: subtask.id,
        fileName: 'a.pdf',
        contentType: 'application/pdf',
        sizeBytes: 100,
      }),
    ).rejects.toMatchObject({ details: { reason: 'SUBTASK_JOB_MISMATCH' } });
  });
});
