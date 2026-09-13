/** DELETE /api/holidays/:id — build spec M9.3. */
import { handler, ok } from '@/lib/api/respond';
import { can } from '@/lib/auth/policy';
import { requireActiveSession } from '@/lib/auth/session';
import { forbidden } from '@/lib/errors';
import { removeHoliday } from '@/lib/services/holiday-service';
import { clientIp } from '@/lib/utils/request';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const DELETE = handler(async (request, context: { params: Promise<{ id: string }> }) => {
  const session = await requireActiveSession();
  if (!can(session, 'holiday:manage', undefined)) throw forbidden();

  const { id } = await context.params;

  return ok({ removed: await removeHoliday(id, session, { ipAddress: clientIp(request) }) });
});
