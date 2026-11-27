/**
 * GET/POST /api/subtasks/:id/store-entries — the store register on a Store task.
 *
 * Anyone who can see the task sees the register; the person holding the Store
 * task (and the MD or Deputy) records lines. Each line is intimated to
 * Production and Planning.
 */
import { handler, ok, parseJson } from '@/lib/api/respond';
import { assertCan } from '@/lib/auth/policy';
import { requireActiveSession } from '@/lib/auth/session';
import { addStoreEntry, listStoreEntries } from '@/lib/services/store-service';
import { getSubtask } from '@/lib/services/subtasks';
import { clientIp } from '@/lib/utils/request';
import { addStoreEntrySchema } from '@/lib/validation/store';

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

    return ok({ data: await listStoreEntries(id) });
  })(request);
}

export async function POST(request: Request, context: RouteContext) {
  return handler(async (req) => {
    const session = await requireActiveSession();
    const { id } = await context.params;

    const subtask = await getSubtask(session, id);
    assertCan(session, 'materials:record', await subtaskViewResource(subtask));

    const input = await parseJson(req, addStoreEntrySchema);
    const data = await addStoreEntry(id, input, session, { ipAddress: clientIp(req) });

    return ok({ data }, { status: 201 });
  })(request);
}
