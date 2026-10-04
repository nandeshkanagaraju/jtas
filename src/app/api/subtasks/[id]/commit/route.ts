/**
 * POST /api/subtasks/:id/commit — the assignee names a finish date once.
 *
 * After this, the date is fixed. Moving it is an extension request. The MD
 * sets or overrides a date through POST /deadline, which is unchanged.
 */
import { handler, ok, parseJson } from '@/lib/api/respond';
import { assertCan } from '@/lib/auth/policy';
import { requireActiveSession } from '@/lib/auth/session';
import { commitDeadline, getSubtask, loadSubtaskForWrite } from '@/lib/services/subtasks';
import { clientIp } from '@/lib/utils/request';
import { commitDeadlineSchema } from '@/lib/validation/subtask';

import { subtaskResource } from '../../subtask-resource';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return handler(async (req) => {
    const session = await requireActiveSession();
    const { id } = await context.params;

    const existing = await loadSubtaskForWrite(id);
    assertCan(session, 'subtask:commit', subtaskResource(existing));

    const input = await parseJson(req, commitDeadlineSchema);
    await commitDeadline(
      id,
      input,
      { id: session.id, role: session.role },
      { ipAddress: clientIp(req) },
    );

    return ok({ subtask: await getSubtask(session, id) });
  })(request);
}
