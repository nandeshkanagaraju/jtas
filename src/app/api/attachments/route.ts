/**
 * GET/POST /api/attachments — build spec M10.2.
 *
 * POST registers an object that has finished uploading; it is where the file's
 * own bytes are checked against its extension, because the upload went straight
 * to the bucket and this is the first moment the server can see them.
 */
import { handler, ok, parseJson } from '@/lib/api/respond';
import { assertCan, can } from '@/lib/auth/policy';
import { requireActiveSession } from '@/lib/auth/session';
import { forbidden, validationError } from '@/lib/errors';
import { listAttachments, registerUpload } from '@/lib/services/attachment-service';
import { getJob, loadJobForWrite } from '@/lib/services/jobs';
import { getSubtask } from '@/lib/services/subtasks';
import { clientIp } from '@/lib/utils/request';
import { registerAttachmentSchema } from '@/lib/validation/settings';

import { subtaskResource, subtaskViewResource } from '../subtasks/subtask-resource';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = handler(async (request) => {
  const session = await requireActiveSession();
  const params = new URL(request.url).searchParams;

  const subtaskId = params.get('subtaskId');
  const jobId = params.get('jobId');

  if (subtaskId) {
    const subtask = await getSubtask(session, subtaskId);
    assertCan(session, 'attachment:view', await subtaskViewResource(subtask));

    return ok({ data: await listAttachments({ subtaskId }) });
  }

  if (!jobId) {
    throw validationError('Say which job or subtask.', {
      fields: { jobId: ['Required when no subtaskId is given.'] },
    });
  }

  // `getJob` already scopes to what this session may see, so reaching here
  // means the job is visible to them.
  await getJob(session, jobId);

  return ok({
    data: await listAttachments({
      jobId,
      jobLevelOnly: params.get('jobLevelOnly') === 'true',
    }),
  });
});

export const POST = handler(async (request) => {
  const session = await requireActiveSession();
  const input = await parseJson(request, registerAttachmentSchema);

  if (input.subtaskId) {
    const subtask = await getSubtask(session, input.subtaskId);
    assertCan(session, 'attachment:create', subtaskResource(subtask));
  } else {
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

  return ok(
    { data: await registerUpload(input, session, { ipAddress: clientIp(request) }) },
    { status: 201 },
  );
});
