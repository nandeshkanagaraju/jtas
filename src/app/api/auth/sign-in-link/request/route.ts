/**
 * POST /api/auth/sign-in-link/request — ask the developer for a sign-in link.
 *
 * Always answers the same way, whether or not the address has an account.
 */
import { guardAuthRate } from '@/lib/api/rate-limit-guard';
import { handler, ok, parseJson } from '@/lib/api/respond';
import { requestSignInLink, REQUEST_TTL_MINUTES } from '@/lib/services/auth';
import { userAgent } from '@/lib/utils/request';
import { signInLinkRequestSchema } from '@/lib/validation/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = handler(async (request) => {
  const ip = await guardAuthRate(request);
  const input = await parseJson(request, signInLinkRequestSchema);

  const { handle } = await requestSignInLink(input, {
    ipAddress: ip,
    userAgent: userAgent(request),
  });

  return ok({ handle, waitMinutes: REQUEST_TTL_MINUTES });
});
