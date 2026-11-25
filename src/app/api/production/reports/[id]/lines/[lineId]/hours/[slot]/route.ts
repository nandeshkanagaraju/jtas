/**
 * PUT    /api/production/reports/:id/lines/:lineId/hours/:slot — records one hour.
 * DELETE /api/production/reports/:id/lines/:lineId/hours/:slot — clears it.
 */
import { handler, ok, parseJson } from '@/lib/api/respond';
import { validationError } from '@/lib/errors';
import { clearHour, getReport, recordHour } from '@/lib/services/production/reports';
import { ALL_ROLES_WITH_SUPERVISOR, requireActiveSession } from '@/lib/auth/session';
import { assertProductionUser } from '@/lib/services/production/session';
import { recordHourSchema } from '@/lib/validation/production';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string; lineId: string; slot: string }> };

function slotNumber(value: string): number {
  const slot = Number(value);
  if (!Number.isInteger(slot) || slot < 0 || slot > 23) throw validationError('Unknown hour.');
  return slot;
}

export async function PUT(request: Request, context: RouteContext) {
  return handler(async (req) => {
    const user = assertProductionUser(await requireActiveSession(ALL_ROLES_WITH_SUPERVISOR));
    const { id, lineId, slot } = await context.params;
    const input = await parseJson(req, recordHourSchema);
    await recordHour(user, id, lineId, slotNumber(slot), input);
    return ok({ data: await getReport(user, id) });
  })(request);
}

export async function DELETE(request: Request, context: RouteContext) {
  return handler(async () => {
    const user = assertProductionUser(await requireActiveSession(ALL_ROLES_WITH_SUPERVISOR));
    const { id, lineId, slot } = await context.params;
    await clearHour(user, id, lineId, slotNumber(slot));
    return ok({ data: await getReport(user, id) });
  })(request);
}
