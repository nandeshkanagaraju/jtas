/**
 * GET    /api/users/:id — detail
 * PATCH  /api/users/:id — edit
 * DELETE /api/users/:id — deactivate (never a hard delete, FR-70)
 *
 * DELETE carries a body: `{ reassignTo?, reason? }`. That is unusual for the
 * verb, but deactivation genuinely needs a hand-over plan, and the SDD assigns
 * this operation to DELETE. Without `reassignTo`, open subtasks make it a 409
 * whose `details.openSubtasks` lists exactly what is in the way.
 */
import { handler, ok, parseJson } from '@/lib/api/respond';
import { assertCan } from '@/lib/auth/policy';
import { requireActiveSession } from '@/lib/auth/session';
import { deactivateUser, getUser, updateUser } from '@/lib/services/users';
import { clientIp } from '@/lib/utils/request';
import { deactivateUserSchema, updateUserSchema } from '@/lib/validation/user';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext) {
  return handler(async () => {
    const session = await requireActiveSession(['MD', 'ADMIN']);
    const { id } = await context.params;

    const user = await getUser(id);
    assertCan(session, 'user:manage', { id: user.id, role: user.role });

    return ok({ user });
  })(request);
}

export async function PATCH(request: Request, context: RouteContext) {
  return handler(async (req) => {
    const session = await requireActiveSession(['MD', 'ADMIN']);
    const { id } = await context.params;

    // Load first: the policy decision depends on the *target's* current role,
    // so an admin cannot edit an MD, and cannot promote somebody to MD either.
    const existing = await getUser(id);
    assertCan(session, 'user:manage', { id: existing.id, role: existing.role });

    const input = await parseJson(req, updateUserSchema);
    if (input.role) {
      assertCan(session, 'user:manage', { id: existing.id, role: input.role });
    }

    const user = await updateUser(id, input, { id: session.id }, { ipAddress: clientIp(req) });

    return ok({ user });
  })(request);
}

export async function DELETE(request: Request, context: RouteContext) {
  return handler(async (req) => {
    const session = await requireActiveSession(['MD', 'ADMIN']);
    const { id } = await context.params;

    const existing = await getUser(id);
    assertCan(session, 'user:manage', { id: existing.id, role: existing.role });

    // DELETE bodies are legal but optional; treat an empty one as "no plan".
    const raw = await req.text();
    const input = raw.trim()
      ? deactivateUserSchema.parse(JSON.parse(raw))
      : deactivateUserSchema.parse({});

    const result = await deactivateUser(
      id,
      input,
      { id: session.id },
      { ipAddress: clientIp(req) },
    );

    return ok({
      user: result.user,
      reassignedTo: result.reassignedTo,
      reassignedSubtaskCount: result.reassigned.length,
    });
  })(request);
}
