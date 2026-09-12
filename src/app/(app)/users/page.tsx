import type { Metadata } from 'next';
import { forbidden } from 'next/navigation';

import { can } from '@/lib/auth/policy';
import { requireActiveSession } from '@/lib/auth/session';
import { listDepartments } from '@/lib/services/department-service';

import { UsersScreen } from './components/users-screen';

export const metadata: Metadata = { title: 'Users' };
export const dynamic = 'force-dynamic';

/**
 * User directory (FR-70, FR-02). MD and Admin only.
 *
 * Middleware lets any signed-in user reach this URL so the refusal is a real
 * 403 rather than a redirect that hides it; the decision is made here, with the
 * same `can()` the API uses.
 */
export default async function UsersPage() {
  const session = await requireActiveSession();
  if (!can(session, 'user:view', undefined)) forbidden();

  // Departments are reference data and change roughly never, so they are
  // fetched on the server and passed down rather than re-fetched per dialog.
  const departments = await listDepartments();

  return (
    <UsersScreen departments={departments} currentUser={{ id: session.id, role: session.role }} />
  );
}
