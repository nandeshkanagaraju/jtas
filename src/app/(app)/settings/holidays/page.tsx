import type { Metadata } from 'next';
import { forbidden } from 'next/navigation';

import { can } from '@/lib/auth/policy';
import { requireActiveSession } from '@/lib/auth/session';
import { listHolidays } from '@/lib/services/holiday-service';

import { SettingsNav } from '../settings-nav';
import { HolidayCalendar } from './holiday-calendar';

export const metadata: Metadata = { title: 'Holiday calendar' };
export const dynamic = 'force-dynamic';

/**
 * The holiday calendar (build spec M9.3).
 *
 * Anyone signed in may look: a member deciding when to promise a deadline needs
 * to know the shop is shut. Only MD and ADMIN may change it.
 */
export default async function HolidaysPage() {
  const session = await requireActiveSession();
  if (!can(session, 'settings:view', undefined)) forbidden();

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Holiday calendar</h1>
        <p className="text-muted-foreground mt-0.5 text-sm">
          Days the shop is shut. A reminder that would land on one moves to the next working
          morning; overdue mail is not held.
        </p>
      </div>

      <SettingsNav current="holidays" />

      <HolidayCalendar
        initial={await listHolidays()}
        canManage={can(session, 'holiday:manage', undefined)}
      />
    </div>
  );
}
