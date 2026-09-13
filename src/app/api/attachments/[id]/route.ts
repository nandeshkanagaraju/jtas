/**
 * DELETE /api/attachments/:id — build spec M10.5.
 *
 * Soft delete only (architecture rule 6). The row and the object both stay; the
 * attachment stops being listed. A drawing removed from a job is part of why
 * the job was built the way it was.
 */
import { handler, ok } from '@/lib/api/respond';
import { assertCan, can } from '@/lib/auth/policy';
import { requireActiveSession } from '@/lib/auth/session';
import { forbidden, notFound } from '@/lib/errors';
import { getAttachment, softDeleteAttachment } from '@/lib/services/attachment-service';
import { loadJobForWrite } from '@/lib/services/jobs';
import { getSubtask } from '@/lib/services/subtasks';
import { clientIp } from '@/lib/utils/request';

import { subtaskResource } from '../../subtasks/subtask-resource';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

export async function DELETE(request: Request, context: RouteContext) {
  return handler(async (req) => {
    const session = await requireActiveSession();
    const { id } = await context.params;

    const attachment = await getAttachment(id);
    if (!attachment) throw notFound('Attachment');

    // Removing a file is the same permission as putting one there.
    if (attachment.subtaskId) {
      const subtask = await getSubtask(session, attachment.subtaskId);
      assertCan(session, 'attachment:create', subtaskResource(subtask));
    } else if (attachment.jobId) {
      const job = await loadJobForWrite(attachment.jobId);
      const resource = { id: job.id, createdById: job.createdBy.id, participantIds: [] };
      if (!can(session, 'job:edit', resource)) throw forbidden();
    } else {
      throw forbidden();
    }

    await softDeleteAttachment(id, session, { ipAddress: clientIp(req) });

    return ok({ deleted: true });
  })(request);
}
