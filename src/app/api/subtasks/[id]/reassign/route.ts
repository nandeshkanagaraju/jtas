/**
 * POST /api/subtasks/:id/reassign — FR-24. MD/Deputy only.
 * Both the old and the new assignee are notified.
 */
import { handler, ok, parseJson } from '@/lib/api/respond';
import { assertCan } from '@/lib/auth/policy';
import { requireActiveSession } from '@/lib/auth/session';
import { getSubtask, loadSubtaskForWrite, reassignSubtask } from '@/lib/services/subtasks';
import { clientIp } from '@/lib/utils/request';
import { reassignSchema } from '@/lib/validation/subtask';

import { subtaskResource } from '../../subtask-resource';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return handler(async (req) => {
    const session = await requireActiveSession(['MD', 'DEPUTY_MD']);
    const { id } = await context.params;

    const existing = await loadSubtaskForWrite(id);
    assertCan(session, 'subtask:reassign', subtaskResource(existing));

    const input = await parseJson(req, reassignSchema);
    await reassignSubtask(
      id,
      input,
      { id: session.id, role: session.role },
      { ipAddress: clientIp(req) },
    );

    return ok({ subtask: await getSubtask(session, id) });
  })(request);
}
