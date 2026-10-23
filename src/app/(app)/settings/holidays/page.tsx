import { T } from '@/lib/i18n/provider';
import type { Metadata } from 'next';
import { forbidden } from 'next/navigation';

import { can } from '@/lib/auth/policy';
import { requireActiveSession } from '@/lib/auth/session';
import { listHolidays } from '@/lib/services/holiday-service';

import { PageHeader } from '@/components/shared/page-header';

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
    <div className="w-full space-y-5">
      <PageHeader
        eyebrow={<T>{'How the system chases work'}</T>}
        title={<T>{'Holiday calendar'}</T>}
        lead={
          <T>
            {
              'Days the shop is shut. A reminder that would land on one moves to the next working morning; overdue mail is not held.'
            }
          </T>
        }
      >
        <SettingsNav current="holidays" />
      </PageHeader>

      <HolidayCalendar
        initial={await listHolidays()}
        canManage={can(session, 'holiday:manage', undefined)}
      />
    </div>
  );
}
