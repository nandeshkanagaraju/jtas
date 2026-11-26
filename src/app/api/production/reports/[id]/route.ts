/**
 * GET   /api/production/reports/:id — the report with its worked-out figures and warnings.
 * PATCH /api/production/reports/:id — the shift remarks.
 */
import { handler, ok, parseJson } from '@/lib/api/respond';
import { getReport, updateRemarks } from '@/lib/services/production/reports';
import { ALL_ROLES_WITH_SUPERVISOR, requireActiveSession } from '@/lib/auth/session';
import { assertProductionUser } from '@/lib/services/production/session';
import { remarksSchema } from '@/lib/validation/production';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext) {
  return handler(async () => {
    const user = assertProductionUser(await requireActiveSession(ALL_ROLES_WITH_SUPERVISOR));
    const { id } = await context.params;
    return ok({ data: await getReport(user, id) });
  })(request);
}

export async function PATCH(request: Request, context: RouteContext) {
  return handler(async (req) => {
    const user = assertProductionUser(await requireActiveSession(ALL_ROLES_WITH_SUPERVISOR));
    const { id } = await context.params;
    const { remarks } = await parseJson(req, remarksSchema);
    await updateRemarks(user, id, remarks ?? null);
    return ok({ data: await getReport(user, id) });
  })(request);
}
