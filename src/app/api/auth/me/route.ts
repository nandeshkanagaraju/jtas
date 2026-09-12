/**
 * GET /api/auth/me — SDD section 6.2: session user plus permissions.
 *
 * The `permissions` block lets the client hide actions it cannot perform. It is
 * a convenience, never a control — the same `can()` call runs server-side on
 * every endpoint (architecture rule 3).
 */
import { handler, ok } from '@/lib/api/respond';
import { can } from '@/lib/auth/policy';
import { requireAuth } from '@/lib/auth/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = handler(async () => {
  const user = await requireAuth();

  return ok({
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      departmentId: user.departmentId,
      mustChangePassword: user.mustChangePassword,
    },
    permissions: {
      createJob: can(user, 'job:create', undefined),
      listJobs: can(user, 'job:list', undefined),
      manageUsers: can(user, 'user:manage', undefined),
      manageSettings: can(user, 'settings:manage', undefined),
      viewAudit: can(user, 'audit:view', undefined),
      viewMdDashboard: can(user, 'dashboard:md', undefined),
      exportReports: can(user, 'report:export', undefined),
    },
  });
});
