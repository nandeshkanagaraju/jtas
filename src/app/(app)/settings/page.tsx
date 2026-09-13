import type { Metadata } from 'next';
import { forbidden } from 'next/navigation';

import { can } from '@/lib/auth/policy';
import { requireActiveSession } from '@/lib/auth/session';
import { listSettings } from '@/lib/services/settings';

import { SettingsNav } from './settings-nav';
import { SettingsForm } from './settings-form';

export const metadata: Metadata = { title: 'Settings' };
export const dynamic = 'force-dynamic';

/**
 * Settings (build spec M9.2).
 *
 * MD and ADMIN. Every field carries what it does and, where it matters, what it
 * does *not* do — changing the default lead time moves the reminder on subtasks
 * published from now on and leaves the ones already scheduled alone.
 */
export default async function SettingsPage() {
  const session = await requireActiveSession();
  if (!can(session, 'settings:view', undefined)) forbidden();

  const settings = await listSettings();
  const readOnly = !can(session, 'settings:manage', undefined);

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-muted-foreground mt-0.5 text-sm">
          How the system chases work. A change takes effect from the next notification it schedules;
          anything already queued keeps the time it was given.
        </p>
      </div>

      <SettingsNav current="general" />

      {readOnly ? (
        <p className="text-muted-foreground rounded-lg border p-4 text-sm">
          You can see these values but not change them.
        </p>
      ) : (
        <SettingsForm initial={settings} />
      )}
    </div>
  );
}
