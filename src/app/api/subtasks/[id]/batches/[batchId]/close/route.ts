/**
 * POST /api/subtasks/:id/batches/:batchId/close — close one batch with its
 * accepted and rejected pieces. Same people as recording material counts.
 */
import { handler, ok, parseJson } from '@/lib/api/respond';
import { assertCan } from '@/lib/auth/policy';
import { requireActiveSession } from '@/lib/auth/session';
import { closeBatch } from '@/lib/services/batch-service';
import { getSubtask } from '@/lib/services/subtasks';
import { clientIp } from '@/lib/utils/request';
import { closeBatchSchema } from '@/lib/validation/batch';

import { subtaskViewResource } from '../../../../subtask-resource';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string; batchId: string }> };

export async function POST(request: Request, context: RouteContext) {
  return handler(async (req) => {
    const session = await requireActiveSession();
    const { id, batchId } = await context.params;

    const subtask = await getSubtask(session, id);
    assertCan(session, 'materials:record', await subtaskViewResource(subtask));

    const input = await parseJson(req, closeBatchSchema);
    const data = await closeBatch(
      id,
      batchId,
      input,
      { id: session.id, role: session.role, managesJobs: session.managesJobs },
      { ipAddress: clientIp(req) },
    );

    return ok({ data });
  })(request);
}
