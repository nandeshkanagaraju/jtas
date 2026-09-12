import type { Metadata } from 'next';
import { forbidden } from 'next/navigation';

import { PlaceholderPage } from '@/components/shared/placeholder-page';
import { can } from '@/lib/auth/policy';
import { requireActiveSession } from '@/lib/auth/session';

export const metadata: Metadata = { title: 'Dashboard' };

/**
 * MD dashboard (FR-60). Access is decided here, server-side, through the same
 * `can()` the API uses — middleware lets a member reach this URL precisely so
 * that the refusal is a real 403 rather than a redirect that hides it.
 */
export default async function DashboardPage() {
  const session = await requireActiveSession();
  if (!can(session, 'dashboard:md', undefined)) forbidden();

  return (
    <PlaceholderPage
      title="Dashboard"
      description="Active jobs, at-risk jobs, overdue subtasks, open problems and on-time percentage."
      module="M8"
    />
  );
}
