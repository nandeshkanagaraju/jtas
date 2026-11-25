/**
 * PATCH  /api/production/reports/:id/lines/:lineId — the line's set-up and final-report figures.
 * DELETE /api/production/reports/:id/lines/:lineId — takes the line off the report.
 */
import { handler, ok, parseJson } from '@/lib/api/respond';
import { deleteLine, getReport, updateLine } from '@/lib/services/production/reports';
import { ALL_ROLES_WITH_SUPERVISOR, requireActiveSession } from '@/lib/auth/session';
import { assertProductionUser } from '@/lib/services/production/session';
import { updateLineSchema } from '@/lib/validation/production';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string; lineId: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  return handler(async (req) => {
    const user = assertProductionUser(await requireActiveSession(ALL_ROLES_WITH_SUPERVISOR));
    const { id, lineId } = await context.params;
    const input = await parseJson(req, updateLineSchema);
    await updateLine(user, id, lineId, input);
    return ok({ data: await getReport(user, id) });
  })(request);
}

export async function DELETE(request: Request, context: RouteContext) {
  return handler(async () => {
    const user = assertProductionUser(await requireActiveSession(ALL_ROLES_WITH_SUPERVISOR));
    const { id, lineId } = await context.params;
    await deleteLine(user, id, lineId);
    return ok({ data: await getReport(user, id) });
  })(request);
}
