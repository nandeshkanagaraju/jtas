/** GET /api/sign-in-requests — the developer's queue of sign-in-link requests. */
import { handler, ok } from '@/lib/api/respond';
import { canApproveSignIn } from '@/lib/auth/developer';
import { requireActiveSession } from '@/lib/auth/session';
import { forbidden } from '@/lib/errors';
import { listSignInRequests } from '@/lib/services/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = handler(async () => {
  const session = await requireActiveSession();
  if (!canApproveSignIn(session))
    throw forbidden('Only the developer can answer sign-in requests.');
  return ok(await listSignInRequests());
});
