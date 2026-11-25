/**
 * POST /api/auth/sign-in-link/status — has the developer answered yet?
 *
 * Polled by the waiting login page every few seconds, so it is not counted
 * against the sign-in rate limit. The handle is 32 random bytes; there is
 * nothing to guess, and the answer is only a status word.
 */
import { z } from 'zod';

import { handler, ok, parseJson } from '@/lib/api/respond';
import { signInRequestStatus } from '@/lib/services/auth';
import { signInSecretSchema } from '@/lib/validation/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({ handle: signInSecretSchema });

export const POST = handler(async (request) => {
  const { handle } = await parseJson(request, schema);
  return ok({ status: await signInRequestStatus(handle) });
});
