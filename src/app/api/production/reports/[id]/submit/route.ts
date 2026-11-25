/** POST /api/production/reports/:id/submit */
import { handler, ok } from '@/lib/api/respond';
import { submitReport, getReport } from '@/lib/services/production/reports';
import { ALL_ROLES_WITH_SUPERVISOR, requireActiveSession } from '@/lib/auth/session';
import { assertProductionUser } from '@/lib/services/production/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext) {
  return handler(async () => {
    const user = assertProductionUser(await requireActiveSession(ALL_ROLES_WITH_SUPERVISOR));
    const { id } = await context.params;
    await submitReport(user, id);
    return ok({ data: await getReport(user, id) });
  })(request);
}
