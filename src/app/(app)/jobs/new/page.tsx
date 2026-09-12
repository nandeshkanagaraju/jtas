import type { Metadata } from 'next';
import { forbidden } from 'next/navigation';

import { can } from '@/lib/auth/policy';
import { requireActiveSession } from '@/lib/auth/session';

import { NewJobWizard } from './new-job-wizard';

export const metadata: Metadata = { title: 'New job' };
export const dynamic = 'force-dynamic';

/** FR-10. MD and Deputy only — the same `can()` the API uses. */
export default async function NewJobPage() {
  const session = await requireActiveSession();
  if (!can(session, 'job:create', undefined)) forbidden();

  return <NewJobWizard />;
}
