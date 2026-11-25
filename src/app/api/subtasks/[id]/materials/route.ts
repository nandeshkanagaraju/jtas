/**
 * GET/POST /api/subtasks/:id/materials — accepted and rejected material counts
 * on a Production, Quality or QA task.
 *
 * Anyone who can see the task's discussion sees the counts; the department
 * holding the task (and the MD or Deputy) records them.
 */
import { handler, ok, parseJson } from '@/lib/api/respond';
import { assertCan } from '@/lib/auth/policy';
import { requireActiveSession } from '@/lib/auth/session';
import { addMaterialCount, listMaterialCounts } from '@/lib/services/material-service';
import { getSubtask } from '@/lib/services/subtasks';
import { clientIp } from '@/lib/utils/request';
import { addMaterialCountSchema } from '@/lib/validation/materials';

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

    return ok({ data: await listMaterialCounts(id) });
  })(request);
}

export async function POST(request: Request, context: RouteContext) {
  return handler(async (req) => {
    const session = await requireActiveSession();
    const { id } = await context.params;

    const subtask = await getSubtask(session, id);
    assertCan(session, 'materials:record', await subtaskViewResource(subtask));

    const input = await parseJson(req, addMaterialCountSchema);
    const data = await addMaterialCount(id, input, session, { ipAddress: clientIp(req) });

    return ok({ data }, { status: 201 });
  })(request);
}
