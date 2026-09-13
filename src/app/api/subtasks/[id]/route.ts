/**
 * GET   /api/subtasks/:id — detail, scoped through the job
 * PATCH /api/subtasks/:id — MD/Deputy metadata edit (SDD section 6.2)
 */
import { handler, ok, parseJson } from '@/lib/api/respond';
import { assertCan } from '@/lib/auth/policy';
import { requireActiveSession } from '@/lib/auth/session';
import { getSubtask, loadSubtaskForWrite, updateSubtaskMeta } from '@/lib/services/subtasks';
import { clientIp } from '@/lib/utils/request';
import { updateSubtaskSchema } from '@/lib/validation/subtask';

import { subtaskResource, subtaskViewResource } from '../subtask-resource';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext) {
  return handler(async () => {
    const session = await requireActiveSession();
    const { id } = await context.params;

    const subtask = await getSubtask(session, id);
    // The view resource carries the job's participants, which is what lets a
    // member read a sibling department's subtask read-only.
    assertCan(session, 'subtask:view', await subtaskViewResource(subtask));

    return ok({ subtask });
  })(request);
}

export async function PATCH(request: Request, context: RouteContext) {
  return handler(async (req) => {
    const session = await requireActiveSession(['MD', 'DEPUTY_MD']);
    const { id } = await context.params;

    const existing = await loadSubtaskForWrite(id);
    assertCan(session, 'subtask:edit', subtaskResource(existing));

    const input = await parseJson(req, updateSubtaskSchema);
    await updateSubtaskMeta(
      id,
      input,
      { id: session.id, role: session.role },
      { ipAddress: clientIp(req) },
    );

    return ok({ subtask: await getSubtask(session, id) });
  })(request);
}
