import type { Metadata } from 'next';

import { LoginForm } from './login-form';

export const metadata: Metadata = { title: 'Sign in' };

/**
 * There is no self-registration anywhere in JTAS (FR-02) — accounts are created
 * by the MD or the administrator — so this screen offers no sign-up link and no
 * self-service password reset.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;

  // Only a same-origin path is carried through, so `?next=` cannot be turned
  // into an open redirect.
  const safeNext = next?.startsWith('/') && !next.startsWith('//') ? next : undefined;

  return <LoginForm next={safeNext} />;
}
