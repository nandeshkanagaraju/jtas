import type { Metadata } from 'next';
import { forbidden } from 'next/navigation';

import { can } from '@/lib/auth/policy';
import { requireActiveSession } from '@/lib/auth/session';
import { listSettings } from '@/lib/services/settings';

import { PageHeader } from '@/components/shared/page-header';
import { Panel } from '@/components/shared/panel';

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
      <PageHeader
        eyebrow="How the system chases work"
        title="Settings"
        lead="A change takes effect from the next notification the system schedules; anything already queued keeps the time it was given."
      >
        <SettingsNav current="general" />
      </PageHeader>

      {readOnly ? (
        <Panel title="Read only">
          <p className="text-muted-foreground text-sm">
            You can see these values but not change them. Ask the Managing Director or an
            administrator to make a change.
          </p>
        </Panel>
      ) : (
        <SettingsForm initial={settings} />
      )}
    </div>
  );
}
