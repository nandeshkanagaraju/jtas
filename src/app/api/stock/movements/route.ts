/**
 * POST /api/stock/movements — pieces produced (Production, the MD, the Deputy)
 * or dispatched (the job managers, the MD, the Deputy) for one part on one day.
 */
import { handler, ok, parseJson } from '@/lib/api/respond';
import { assertCan } from '@/lib/auth/policy';
import { requireActiveSession } from '@/lib/auth/session';
import { validationError } from '@/lib/errors';
import { recordStockMovement } from '@/lib/services/shop-reports/stock-ledger';
import { clientIp } from '@/lib/utils/request';
import { istDateKey } from '@/lib/utils/time';
import { recordStockMovementSchema } from '@/lib/validation/stock';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = handler(async (request) => {
  const session = await requireActiveSession();
  const input = await parseJson(request, recordStockMovementSchema);
  assertCan(
    session,
    input.kind === 'PRODUCED' ? 'stock:recordProduced' : 'stock:recordDispatch',
    undefined,
  );
  if (input.date > istDateKey(new Date())) {
    throw validationError('The date cannot be in the future.', {
      fields: { date: ['The date cannot be in the future.'] },
    });
  }

  const saved = await recordStockMovement(input, session, { ipAddress: clientIp(request) });
  return ok({ data: { id: saved.id } }, { status: 201 });
});
