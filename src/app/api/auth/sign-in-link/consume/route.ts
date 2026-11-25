/**
 * POST /api/auth/sign-in-link/consume — sign in with the mailed link.
 *
 * A POST from the "Continue" button rather than the link's GET, because mail
 * scanners open links on their own and would otherwise use it up.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { setSessionCookies } from '@/lib/auth/cookies';
import { guardAuthRate } from '@/lib/api/rate-limit-guard';
import { handler, parseJson } from '@/lib/api/respond';
import { signInWithLink } from '@/lib/services/auth';
import { signInSecretSchema } from '@/lib/validation/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({ token: signInSecretSchema });

export const POST = handler(async (request) => {
  const ip = await guardAuthRate(request);
  const { token } = await parseJson(request, schema);

  const { user, tokens } = await signInWithLink(token, { ipAddress: ip });

  const response = NextResponse.json({
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      departmentId: user.departmentId,
      mustChangePassword: user.mustChangePassword,
    },
    mustChangePassword: user.mustChangePassword,
  });

  return setSessionCookies(response, tokens);
});
