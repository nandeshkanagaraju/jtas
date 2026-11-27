/**
 * GET /api/stock?from=YYYY-MM-DD&to=YYYY-MM-DD&format=json|xlsx|pdf — the daily
 * stock ledger per part (see stock-ledger.ts for the arithmetic).
 *
 * The MD, the Deputy, the job managers, Store and Production (`stock:view`).
 */
import { fileResponse, PDF_TYPE, XLSX_TYPE } from '@/lib/api/file-response';
import { handler, ok, parseQuery } from '@/lib/api/respond';
import { assertCan } from '@/lib/auth/policy';
import { requireActiveSession } from '@/lib/auth/session';
import { stockWorkbook } from '@/lib/services/shop-reports/excel';
import { stockPdf } from '@/lib/services/shop-reports/pdf';
import { stockLedger } from '@/lib/services/shop-reports/stock-ledger';
import { stockRangeSchema } from '@/lib/validation/stock';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = handler(async (request) => {
  const session = await requireActiveSession();
  assertCan(session, 'stock:view', undefined);

  const { from, to, format } = parseQuery(new URL(request.url), stockRangeSchema);
  const ledger = await stockLedger(from, to);
  const name = from === to ? `Stock-${from}` : `Stock-${from}-to-${to}`;

  if (format === 'xlsx') {
    const body = await stockWorkbook(ledger).xlsx.writeBuffer();
    return fileResponse(new Uint8Array(body), `${name}.xlsx`, XLSX_TYPE);
  }
  if (format === 'pdf') return fileResponse(await stockPdf(ledger), `${name}.pdf`, PDF_TYPE);
  return ok({ data: ledger });
});
