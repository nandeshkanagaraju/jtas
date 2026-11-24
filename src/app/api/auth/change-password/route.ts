/**
 * POST /api/auth/change-password — SDD section 6.2, FR-03.
 *
 * Closed: passwords are set by the organisation and nobody changes their own
 * (the MD's rule). The administrator sets them with
 * `pnpm users:provision-departments` or the Users screen. The handler below
 * is kept so reopening self-service is a one-line change.
 */
import { NextResponse } from 'next/server';

import { setSessionCookies } from '@/lib/auth/cookies';
import { guardAuthRate } from '@/lib/api/rate-limit-guard';
import { handler, parseJson } from '@/lib/api/respond';
import { requireAuth } from '@/lib/auth/session';
import { forbidden } from '@/lib/errors';
import { changePassword } from '@/lib/services/auth';
import { changePasswordSchema } from '@/lib/validation/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The organisation owns every password. */
const SELF_SERVICE_PASSWORD_CHANGE = false;

export const POST = handler(async (request) => {
  const ip = await guardAuthRate(request);
  const session = await requireAuth();
  if (!SELF_SERVICE_PASSWORD_CHANGE) {
    throw forbidden('Passwords are set by the organisation. Ask the administrator to change it.');
  }
  const input = await parseJson(request, changePasswordSchema);

  const { user, tokens } = await changePassword(session.id, input, { ipAddress: ip });

  const response = NextResponse.json({
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      departmentId: user.departmentId,
      mustChangePassword: user.mustChangePassword,
    },
  });

  // The change revoked every other session and minted a new pair; without
  // re-setting the cookies the caller would be signed out of this device too.
  return setSessionCookies(response, tokens);
});
