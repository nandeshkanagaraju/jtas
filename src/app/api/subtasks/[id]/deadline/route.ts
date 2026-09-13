/**
 * POST /api/subtasks/:id/deadline — SDD sections 4.5 and 6.2. MD/Deputy only.
 *
 * A member's legitimate route to more time is an extension request (FR-33,
 * improvement I-11), not this endpoint — FR-35 is explicit that a member cannot
 * edit their own deadline.
 */
import { handler, ok, parseJson } from '@/lib/api/respond';
import { assertCan } from '@/lib/auth/policy';
import { requireActiveSession } from '@/lib/auth/session';
import { changeDeadline, getSubtask, loadSubtaskForWrite } from '@/lib/services/subtasks';
import { clientIp } from '@/lib/utils/request';
import { changeDeadlineSchema } from '@/lib/validation/subtask';

import { subtaskResource } from '../../subtask-resource';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return handler(async (req) => {
    const session = await requireActiveSession(['MD', 'DEPUTY_MD']);
    const { id } = await context.params;

    const existing = await loadSubtaskForWrite(id);
    assertCan(session, 'subtask:changeDeadline', subtaskResource(existing));

    const input = await parseJson(req, changeDeadlineSchema);
    await changeDeadline(
      id,
      input,
      { id: session.id, role: session.role },
      { ipAddress: clientIp(req) },
    );

    return ok({ subtask: await getSubtask(session, id) });
  })(request);
}
