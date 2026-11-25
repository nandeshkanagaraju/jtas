import type { Metadata } from 'next';

import { LinkContinue } from './link-continue';

export const metadata: Metadata = { title: 'Sign in' };
export const dynamic = 'force-dynamic';

/**
 * Where the mailed sign-in link lands. Nothing happens on load: mail scanners
 * open links by themselves, so the link is only used when the person presses
 * Continue.
 */
export default async function SignInLinkPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  return <LinkContinue token={token ?? null} />;
}
