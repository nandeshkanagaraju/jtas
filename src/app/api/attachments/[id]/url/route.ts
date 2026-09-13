/**
 * GET /api/attachments/:id/url — build spec M10.2.
 *
 * Mints a short-lived presigned GET. The bucket is never public, so this is the
 * only way to read an object — and the URL expires in five minutes, because it
 * carries its own authorisation and anything that copies it copies access.
 */
import { handler, ok } from '@/lib/api/respond';
import { assertCan } from '@/lib/auth/policy';
import { requireActiveSession } from '@/lib/auth/session';
import { forbidden, notFound } from '@/lib/errors';
import { attachmentUrl, getAttachment } from '@/lib/services/attachment-service';
import { getJob } from '@/lib/services/jobs';
import { getSubtask } from '@/lib/services/subtasks';

import { subtaskViewResource } from '../../../subtasks/subtask-resource';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext) {
  return handler(async (req) => {
    const session = await requireActiveSession();
    const { id } = await context.params;

    const attachment = await getAttachment(id);
    if (!attachment) throw notFound('Attachment');

    // Whoever may see the thing it hangs off may read it.
    if (attachment.subtaskId) {
      const subtask = await getSubtask(session, attachment.subtaskId);
      assertCan(session, 'attachment:view', await subtaskViewResource(subtask));
    } else if (attachment.jobId) {
      await getJob(session, attachment.jobId);
    } else {
      throw forbidden();
    }

    const disposition =
      new URL(req.url).searchParams.get('disposition') === 'inline' ? 'inline' : 'attachment';

    return ok(await attachmentUrl(id, { disposition }));
  })(request);
}
