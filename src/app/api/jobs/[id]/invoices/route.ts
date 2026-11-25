/**
 * GET/POST /api/jobs/:id/invoices — Accounts billing on a job.
 *
 * Visible and writable only to the Accounts department, the MD and the
 * Deputy; anyone else gets a 403 even if they can see the job, because the
 * figures are commercial.
 */
import { handler, ok, parseJson } from '@/lib/api/respond';
import { requireActiveSession } from '@/lib/auth/session';
import { forbidden } from '@/lib/errors';
import { addInvoice, canManageBilling, jobBilling } from '@/lib/services/billing-service';
import { getJob } from '@/lib/services/jobs';
import { clientIp } from '@/lib/utils/request';
import { addInvoiceSchema } from '@/lib/validation/invoice';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

const REFUSAL = 'Invoices are visible to Accounts, the MD and the Deputy only.';

export async function GET(request: Request, context: RouteContext) {
  return handler(async () => {
    const session = await requireActiveSession();
    const { id } = await context.params;
    await getJob(session, id); // scoped: NOT_FOUND when the job is not theirs to see
    if (!(await canManageBilling(session))) throw forbidden(REFUSAL);
    return ok({ data: await jobBilling(id) });
  })(request);
}

export async function POST(request: Request, context: RouteContext) {
  return handler(async (req) => {
    const session = await requireActiveSession();
    const { id } = await context.params;
    await getJob(session, id);
    if (!(await canManageBilling(session))) throw forbidden(REFUSAL);
    const input = await parseJson(req, addInvoiceSchema);
    const data = await addInvoice(id, input, session, { ipAddress: clientIp(req) });
    return ok({ data }, { status: 201 });
  })(request);
}
