/** POST /api/production/reports/:id/lines — puts a machine (and its part) on the report. */
import { handler, ok, parseJson } from '@/lib/api/respond';
import { addLine, getReport } from '@/lib/services/production/reports';
import { ALL_ROLES_WITH_SUPERVISOR, requireActiveSession } from '@/lib/auth/session';
import { assertProductionUser } from '@/lib/services/production/session';
import { addLineSchema } from '@/lib/validation/production';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext) {
  return handler(async (req) => {
    const user = assertProductionUser(await requireActiveSession(ALL_ROLES_WITH_SUPERVISOR));
    const { id } = await context.params;
    const input = await parseJson(req, addLineSchema);
    await addLine(user, id, input);
    return ok({ data: await getReport(user, id) }, { status: 201 });
  })(request);
}
