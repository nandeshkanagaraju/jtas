/**
 * POST /api/users/:id/reset-password — SDD section 6.2.
 *
 * Returns a fresh temporary password once. Every existing session for that user
 * is revoked, because an administrator resets a password precisely when they
 * suspect the old one is compromised.
 */
import { handler, ok } from '@/lib/api/respond';
import { assertCan } from '@/lib/auth/policy';
import { requireActiveSession } from '@/lib/auth/session';
import { getUser, resetPassword } from '@/lib/services/users';
import { clientIp } from '@/lib/utils/request';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return handler(async (req) => {
    const session = await requireActiveSession(['MD', 'ADMIN']);
    const { id } = await context.params;

    const existing = await getUser(id);
    assertCan(session, 'user:manage', { id: existing.id, role: existing.role });

    const { user, temporaryPassword } = await resetPassword(
      id,
      { id: session.id },
      { ipAddress: clientIp(req) },
    );

    return ok({ user, temporaryPassword });
  })(request);
}
