import { redirect } from 'next/navigation';

import { AppHeader } from '@/components/shared/app-header';
import type { NavItem } from '@/components/shared/main-nav';
import { Toaster } from '@/components/ui/sonner';
import { can } from '@/lib/auth/policy';
import { listNotifications } from '@/lib/notifications/notification-service';
import { listProblems } from '@/lib/services/problems';
import { getSession } from '@/lib/auth/session';

/**
 * Shell for every signed-in screen. Resolves the session once and hands it to
 * the header, so a page below does not have to.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect('/login');
  if (session.mustChangePassword) redirect('/change-password');

  const [nav, inbox] = await Promise.all([
    buildNav(session),
    listNotifications(session.id, { unreadOnly: true, limit: 1 }),
  ]);

  return (
    <div className="flex min-h-dvh flex-col">
      <AppHeader
        name={session.name}
        email={session.email}
        role={session.role}
        nav={nav}
        unreadNotifications={inbox.unreadCount}
      />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6">{children}</main>

      {/*
        Bottom-centre on a phone: a toast at the top would sit under the sticky
        summary strip, and one in a corner is easy to miss with a glove on.
      */}
      <Toaster position="bottom-center" richColors closeButton />
    </div>
  );
}

/**
 * The links this user gets, and the problem count beside one of them.
 *
 * The count is loaded here rather than by the header so it is server-rendered
 * with the page — an MD should see the queue length in the first paint, not
 * after a round trip.
 */
async function buildNav(session: NonNullable<Awaited<ReturnType<typeof getSession>>>) {
  const nav: NavItem[] = [];

  if (can(session, 'dashboard:md', undefined)) {
    nav.push({ href: '/dashboard', label: 'Dashboard', icon: 'jobs' });
  }

  // Every role that can see a job at all gets the jobs list; it scopes itself.
  if (session.role !== 'ADMIN') {
    nav.push({ href: '/jobs', label: 'Jobs', icon: 'jobs' });
  }

  if (can(session, 'dashboard:md', undefined)) {
    const { counts } = await listProblems({ open: true });
    nav.push({
      href: '/problems',
      label: 'Problems',
      icon: 'problems',
      badge: counts.open + counts.acknowledged,
      // Red once anything has been waiting a day (PDD section 12).
      badgeUrgent: counts.stale > 0,
    });
  }

  // Reports is a commander's view of everybody's record — the same gate as the
  // department scorecards it opens on. Admin exports through the API instead.
  if (can(session, 'dashboard:department', undefined)) {
    nav.push({ href: '/reports', label: 'Reports', icon: 'reports' });
  }

  nav.push({ href: '/my-tasks', label: 'My tasks', icon: 'my-tasks' });

  if (can(session, 'user:view', undefined)) {
    nav.push({ href: '/users', label: 'Users', icon: 'users' });
  }

  return nav;
}
