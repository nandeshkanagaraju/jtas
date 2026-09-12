/**
 * POST /api/auth/login — SDD section 6.2.
 *
 * Handler responsibilities only (architecture rule 2): rate-limit, validate
 * with the shared Zod schema, call the service, set cookies, map errors.
 */
import { NextResponse } from 'next/server';

import { setSessionCookies } from '@/lib/auth/cookies';
import { guardAuthRate } from '@/lib/api/rate-limit-guard';
import { handler, parseJson } from '@/lib/api/respond';
import { rateLimiter } from '@/lib/auth/rate-limit';
import { login } from '@/lib/services/auth-service';
import { loginSchema } from '@/lib/validation/auth';

// bcrypt and Prisma both need Node APIs, so this cannot run on the edge.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = handler(async (request) => {
  const ip = await guardAuthRate(request);
  const input = await parseJson(request, loginSchema);

  const { user, tokens } = await login(input, { ipAddress: ip });

  // A legitimate sign-in should not leave the user throttled by their own
  // earlier typos.
  await rateLimiter.reset(`auth:${ip}`);

  const response = NextResponse.json({
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      departmentId: user.departmentId,
      mustChangePassword: user.mustChangePassword,
    },
    // The client redirects on this rather than deciding for itself (FR-03).
    mustChangePassword: user.mustChangePassword,
  });

  return setSessionCookies(response, tokens);
});
