import { redirect } from 'next/navigation';

import { AppHeader } from '@/components/shared/app-header';
import { getSession } from '@/lib/auth/session';

/**
 * Shell for every signed-in screen. Resolves the session once and hands it to
 * the header, so a page below does not have to.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect('/login');
  if (session.mustChangePassword) redirect('/change-password');

  return (
    <div className="flex min-h-dvh flex-col">
      <AppHeader name={session.name} email={session.email} role={session.role} />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6">{children}</main>
    </div>
  );
}
