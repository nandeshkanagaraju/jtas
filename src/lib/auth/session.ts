/**
 * Reading the current session.
 *
 * Two entry points with different failure behaviour:
 *
 *   getSession()  — for React Server Components. Returns `null` when there is
 *                   no session, because a page decides for itself whether that
 *                   means a redirect or a signed-out view.
 *   requireAuth() — for route handlers. Throws `UNAUTHENTICATED`, which the
 *                   handler wrapper maps to a 401 envelope.
 *
 * Both re-read the user from the database rather than trusting the JWT claims.
 * The access token is a 15-minute snapshot: without the re-read, deactivating a
 * user (FR-70) or changing their role would not take effect until the token
 * expired. At 15 concurrent users one indexed primary-key lookup per request is
 * the right trade for that guarantee.
 */
import { cookies } from 'next/headers';

import { prisma } from '@/lib/db/prisma';
import { forbidden, unauthenticated } from '@/lib/errors';
import type { ProductionSection, Role } from '@prisma/client';

import { ACCESS_COOKIE } from './cookies';
import { verifyAccessToken } from './jwt';
import { isJobManager } from './job-managers';
import { READ_ALL_JOBS_DEPARTMENTS, type PolicySubject } from './policy';

/**
 * The signed-in user.
 *
 * Structurally a {@link PolicySubject}, so it can be handed straight to
 * `can()` without a mapping step.
 */
export interface SessionUser extends PolicySubject {
  id: string;
  name: string;
  email: string;
  role: Role;
  departmentId: string | null;
  isActive: boolean;
  mustChangePassword: boolean;
  /** For a supervisor: the production book they keep. Null for both. */
  productionSection: ProductionSection | null;
}

/**
 * Resolves the session from the access cookie, or `null`.
 *
 * Safe to call from a React Server Component.
 */
export async function getSession(): Promise<SessionUser | null> {
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) return null;

  const claims = await verifyAccessToken(token);
  if (!claims) return null;

  return loadSessionUser(claims.sub);
}

/**
 * Resolves the session or throws.
 *
 * @param roles When given, the user's role must be one of them. This is a
 *              coarse gate at the door — the object-level decision still goes
 *              through `can()` (architecture rule 3).
 * @throws {AppError} `UNAUTHENTICATED` with no valid session,
 *         `FORBIDDEN` when the role is not permitted.
 */
export async function requireAuth(roles?: readonly Role[]): Promise<SessionUser> {
  const user = await getSession();
  if (!user) throw unauthenticated();

  // A user deactivated mid-session loses access on their next request.
  if (!user.isActive) {
    throw unauthenticated('This account has been deactivated. Contact the administrator.');
  }

  if (roles && !roles.includes(user.role)) throw forbidden();

  return user;
}

/**
 * Every role, the production supervisor included. A route passes this to
 * {@link requireActiveSession} when a supervisor may call it: the production
 * routes, and the inbox and push settings the page shell uses.
 */
export const ALL_ROLES_WITH_SUPERVISOR: readonly Role[] = [
  'MD',
  'DEPUTY_MD',
  'ADMIN',
  'MEMBER',
  'SUPERVISOR',
];

/**
 * Like {@link requireAuth}, but also refuses anyone who still owes a password
 * change. Applied to every route except change-password and logout, so a user
 * cannot skip the forced change by calling the API directly (FR-03).
 *
 * @throws {AppError} `FORBIDDEN` when a password change is outstanding.
 */
export async function requireActiveSession(roles?: readonly Role[]): Promise<SessionUser> {
  const user = await requireAuth(roles);

  if (user.mustChangePassword) {
    throw forbidden('You must change your password before continuing.');
  }

  // A production supervisor is kept to the production book: a JTAS route
  // refuses them unless it names the role.
  if (user.role === 'SUPERVISOR' && !roles?.includes('SUPERVISOR')) {
    throw forbidden('This account keeps the production report only.');
  }

  return user;
}

/** Loads the authoritative user record for a verified subject id. */
async function loadSessionUser(userId: string): Promise<SessionUser | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      departmentId: true,
      isActive: true,
      mustChangePassword: true,
      productionSection: true,
      department: { select: { code: true } },
    },
  });
  if (!user) return null;

  const { department, ...rest } = user;
  return {
    ...rest,
    readsAllJobs: department ? READ_ALL_JOBS_DEPARTMENTS.has(department.code) : false,
    managesJobs: isJobManager(rest),
  };
}
