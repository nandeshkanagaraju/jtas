/** POST /api/sign-in-requests/:id/reject — developer only. */
import { handler, ok } from '@/lib/api/respond';
import { canApproveSignIn } from '@/lib/auth/developer';
import { requireActiveSession } from '@/lib/auth/session';
import { forbidden } from '@/lib/errors';
import { rejectSignInRequest } from '@/lib/services/auth';
import { clientIp } from '@/lib/utils/request';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return handler(async (req) => {
    const session = await requireActiveSession();
    if (!canApproveSignIn(session)) {
      throw forbidden('Only the developer can answer sign-in requests.');
    }
    const { id } = await context.params;
    await rejectSignInRequest(id, { id: session.id }, { ipAddress: clientIp(req) });
    return ok({ ok: true });
  })(request);
}
