import type { Metadata } from 'next';

import { PlaceholderPage } from '@/components/shared/placeholder-page';
import { requireActiveSession } from '@/lib/auth/session';

export const metadata: Metadata = { title: 'My tasks' };

/**
 * The member's home screen (FR-30) and the only screen members are trained on
 * (SDD section 10.5). Every signed-in role can open it — an MD or Deputy may
 * hold subtasks too — so there is no capability check beyond having a session.
 */
export default async function MyTasksPage() {
  await requireActiveSession();

  return (
    <PlaceholderPage
      title="My tasks"
      description="Overdue, due today, due this week, blocked and done — grouped so the next thing to do is obvious."
      module="M5"
    />
  );
}
