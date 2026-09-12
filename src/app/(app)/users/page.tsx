import type { Metadata } from 'next';
import { forbidden } from 'next/navigation';

import { PlaceholderPage } from '@/components/shared/placeholder-page';
import { can } from '@/lib/auth/policy';
import { requireActiveSession } from '@/lib/auth/session';

export const metadata: Metadata = { title: 'Users' };

/** User directory (FR-70). MD and Admin only. */
export default async function UsersPage() {
  const session = await requireActiveSession();
  if (!can(session, 'user:view', undefined)) forbidden();

  return (
    <PlaceholderPage
      title="Users"
      description="Create users, assign a department and role, reset passwords, and deactivate without deleting."
      module="M2"
    />
  );
}
