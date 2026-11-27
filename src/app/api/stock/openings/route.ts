/**
 * PUT /api/stock/openings — enter or correct one part's opening stock (raw
 * material and finished goods in hand at the start of a day).
 */
import { handler, ok, parseJson } from '@/lib/api/respond';
import { assertCan } from '@/lib/auth/policy';
import { requireActiveSession } from '@/lib/auth/session';
import { setStockOpening } from '@/lib/services/shop-reports/stock-ledger';
import { clientIp } from '@/lib/utils/request';
import { setStockOpeningSchema } from '@/lib/validation/stock';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const PUT = handler(async (request) => {
  const session = await requireActiveSession();
  assertCan(session, 'stock:setOpening', undefined);

  const input = await parseJson(request, setStockOpeningSchema);
  const saved = await setStockOpening(input, session, { ipAddress: clientIp(request) });
  return ok({ data: { id: saved.id } });
});
