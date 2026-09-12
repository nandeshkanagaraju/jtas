import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { getSession } from '@/lib/auth/session';

import { ChangePasswordForm } from './change-password-form';

export const metadata: Metadata = { title: 'Change password' };

export default async function ChangePasswordPage() {
  const session = await getSession();

  // Middleware normally handles this; the check is repeated because a page must
  // never depend on middleware for access control (architecture rule 3).
  if (!session) redirect('/login');

  return (
    <ChangePasswordForm
      forced={session.mustChangePassword}
      role={session.role}
      email={session.email}
    />
  );
}
