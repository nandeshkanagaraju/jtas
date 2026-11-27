/**
 * POST /api/jobs/:id/intimate-accounts — Planning tells Accounts the job is
 * ready to invoice. Accounts is mailed; the job register and billing page show it.
 */
import { handler, ok, parseJson } from '@/lib/api/respond';
import { requireActiveSession } from '@/lib/auth/session';
import { intimateAccounts, intimateAccountsSchema } from '@/lib/services/accounts-intimation';
import { clientIp } from '@/lib/utils/request';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return handler(async (req) => {
    const session = await requireActiveSession();
    const { id } = await context.params;

    const input = await parseJson(req, intimateAccountsSchema);
    const data = await intimateAccounts(id, input, session, { ipAddress: clientIp(req) });

    return ok({ data });
  })(request);
}
