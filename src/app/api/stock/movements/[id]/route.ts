/**
 * DELETE /api/stock/movements/:id — removes a production or dispatch line typed
 * by mistake. The person who typed it, or the MD or Deputy.
 */
import { handler, noContent } from '@/lib/api/respond';
import { assertCan } from '@/lib/auth/policy';
import { requireActiveSession } from '@/lib/auth/session';
import { deleteStockMovement } from '@/lib/services/shop-reports/stock-ledger';
import { clientIp } from '@/lib/utils/request';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

export async function DELETE(request: Request, context: RouteContext) {
  return handler(async (req) => {
    const session = await requireActiveSession();
    assertCan(session, 'stock:view', undefined);
    const { id } = await context.params;
    await deleteStockMovement(id, session, { ipAddress: clientIp(req) });
    return noContent();
  })(request);
}
