/**
 * GET/POST /api/subtasks/:id/batches — the dated batches of a Production or
 * Quality task.
 *
 * The holder plans them once, when their turn arrives (the batch version of
 * committing a date). The MD or a job manager may re-plan the open batches
 * afterwards, with a reason.
 */
import { handler, ok, parseJson } from '@/lib/api/respond';
import { assertCan, can } from '@/lib/auth/policy';
import { requireActiveSession } from '@/lib/auth/session';
import { forbidden } from '@/lib/errors';
import { listBatches, planBatches } from '@/lib/services/batch-service';
import { getSubtask, loadSubtaskForWrite } from '@/lib/services/subtasks';
import { clientIp } from '@/lib/utils/request';
import { planBatchesSchema } from '@/lib/validation/batch';

import { subtaskResource, subtaskViewResource } from '../../subtask-resource';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext) {
  return handler(async () => {
    const session = await requireActiveSession();
    const { id } = await context.params;

    const subtask = await getSubtask(session, id);
    assertCan(session, 'subtask:view', await subtaskViewResource(subtask));

    return ok({ data: await listBatches(id) });
  })(request);
}

export async function POST(request: Request, context: RouteContext) {
  return handler(async (req) => {
    const session = await requireActiveSession();
    const { id } = await context.params;

    const resource = subtaskResource(await loadSubtaskForWrite(id));
    const managesTask = can(session, 'subtask:changeDeadline', resource);
    if (!managesTask && !can(session, 'subtask:commit', resource)) {
      throw forbidden('Only the person who holds this task can plan its batches.');
    }

    const input = await parseJson(req, planBatchesSchema);
    const data = await planBatches(
      id,
      input,
      { id: session.id, role: session.role, managesJobs: session.managesJobs, managesTask },
      { ipAddress: clientIp(req) },
    );

    return ok({ data }, { status: 201 });
  })(request);
}
