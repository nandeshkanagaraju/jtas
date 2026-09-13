/**
 * GET/POST /api/subtasks/:id/comments — build spec M10.1.
 *
 * Scoped through `can()`: a member may comment on subtasks of jobs they
 * participate in, the MD anywhere. The view resource carries the job's
 * participants, which is what makes "jobs they participate in" decidable —
 * without it a member could only comment on their own subtask.
 */
import { handler, ok, parseJson } from '@/lib/api/respond';
import { assertCan } from '@/lib/auth/policy';
import { requireActiveSession } from '@/lib/auth/session';
import { addComment, listComments, mentionCandidates } from '@/lib/services/comment-service';
import { getSubtask } from '@/lib/services/subtasks';
import { clientIp } from '@/lib/utils/request';
import { addCommentSchema } from '@/lib/validation/settings';

import { subtaskViewResource } from '../../subtask-resource';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext) {
  return handler(async () => {
    const session = await requireActiveSession();
    const { id } = await context.params;

    const subtask = await getSubtask(session, id);
    assertCan(session, 'comment:view', await subtaskViewResource(subtask));

    const [data, candidates] = await Promise.all([listComments(id), mentionCandidates(id)]);

    return ok({ data, mentionCandidates: candidates });
  })(request);
}

export async function POST(request: Request, context: RouteContext) {
  return handler(async (req) => {
    const session = await requireActiveSession();
    const { id } = await context.params;

    const subtask = await getSubtask(session, id);
    assertCan(session, 'comment:create', await subtaskViewResource(subtask));

    const { body } = await parseJson(req, addCommentSchema);

    return ok(
      { data: await addComment(id, body, session, { ipAddress: clientIp(req) }) },
      { status: 201 },
    );
  })(request);
}
