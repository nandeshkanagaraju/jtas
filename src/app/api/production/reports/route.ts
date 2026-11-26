/**
 * GET  /api/production/reports — the reports this user may see, newest first.
 * POST /api/production/reports — opens (or returns) the page for a shift. Supervisors only.
 */
import { handler, ok, parseJson, parseQuery } from '@/lib/api/respond';
import { listReports, openReport } from '@/lib/services/production/reports';
import { ALL_ROLES_WITH_SUPERVISOR, requireActiveSession } from '@/lib/auth/session';
import { assertProductionUser } from '@/lib/services/production/session';
import { listReportsQuery, openReportSchema } from '@/lib/validation/production';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = handler(async (request) => {
  const user = assertProductionUser(await requireActiveSession(ALL_ROLES_WITH_SUPERVISOR));
  const filters = parseQuery(new URL(request.url), listReportsQuery);
  return ok({ data: await listReports(user, filters) });
});

export const POST = handler(async (request) => {
  const user = assertProductionUser(await requireActiveSession(ALL_ROLES_WITH_SUPERVISOR));
  const input = await parseJson(request, openReportSchema);
  const result = await openReport(user, input);
  return ok({ data: result }, { status: result.created ? 201 : 200 });
});
