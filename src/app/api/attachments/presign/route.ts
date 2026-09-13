/**
 * POST /api/attachments/presign — build spec M10.2.
 *
 * Returns a URL the browser PUTs the file to. The storage key is built here
 * from ids the server already trusts; the client never supplies a path.
 */
import { handler, ok, parseJson } from '@/lib/api/respond';
import { assertCan, can } from '@/lib/auth/policy';
import { requireActiveSession } from '@/lib/auth/session';
import { forbidden, validationError } from '@/lib/errors';
import { presignAttachment } from '@/lib/services/attachment-service';
import { loadJobForWrite } from '@/lib/services/jobs';
import { getSubtask } from '@/lib/services/subtasks';
import { storageConfigured } from '@/lib/storage/s3';
import { presignAttachmentSchema } from '@/lib/validation/settings';

import { subtaskResource } from '../../subtasks/subtask-resource';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = handler(async (request) => {
  const session = await requireActiveSession();

  if (!storageConfigured()) {
    // A named refusal beats an SDK error about a missing credential chain.
    throw validationError('Attachment storage is not configured on this server.', {
      reason: 'STORAGE_NOT_CONFIGURED',
    });
  }

  const input = await parseJson(request, presignAttachmentSchema);

  if (input.subtaskId) {
    const subtask = await getSubtask(session, input.subtaskId);
    assertCan(session, 'attachment:create', subtaskResource(subtask));
  } else {
    /*
     * A job-level attachment — the customer drawing, the PO. That belongs to
     * whoever runs the job, so it is gated on editing the job rather than on a
     * subtask nobody owns.
     */
    const job = await loadJobForWrite(input.jobId);
    const resource = {
      id: job.id,
      createdById: job.createdBy.id,
      // Editing a job is an MD/Deputy action; the participant list is only
      // consulted for member-scoped questions, which this is not.
      participantIds: [],
    };

    if (!can(session, 'job:edit', resource)) throw forbidden();
  }

  return ok(await presignAttachment(input));
});
