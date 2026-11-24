/**
 * POST /api/users/:id/set-password — developer only.
 *
 * Sets any account's password, the MD's included, to the value the developer
 * typed. Every existing session for that user is revoked and the change is
 * audited without password material.
 */
import { z } from 'zod';

import { handler, ok, parseJson } from '@/lib/api/respond';
import { canSetAnyPassword } from '@/lib/auth/developer';
import { assertPasswordPolicy } from '@/lib/auth/password-policy';
import { requireActiveSession } from '@/lib/auth/session';
import { forbidden } from '@/lib/errors';
import { setPassword } from '@/lib/services/users';
import { clientIp } from '@/lib/utils/request';
import { passwordSchema } from '@/lib/validation/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const setPasswordSchema = z.object({ password: passwordSchema });

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return handler(async (req) => {
    const session = await requireActiveSession();
    if (!canSetAnyPassword(session)) {
      throw forbidden('Only the developer can set another account’s password.');
    }
    const { id } = await context.params;
    const { password } = await parseJson(req, setPasswordSchema);
    assertPasswordPolicy(password, 'password');

    const user = await setPassword(id, password, { id: session.id }, { ipAddress: clientIp(req) });
    return ok({ user });
  })(request);
}
