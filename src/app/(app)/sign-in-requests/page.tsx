import type { Metadata } from 'next';
import { forbidden } from 'next/navigation';

import { canApproveSignIn } from '@/lib/auth/developer';
import { requireActiveSession } from '@/lib/auth/session';
import { listSignInRequests } from '@/lib/services/auth';

import { SignInRequestsScreen } from './sign-in-requests-screen';

export const metadata: Metadata = { title: 'Sign-in requests' };
export const dynamic = 'force-dynamic';

/** Developer only: accept or decline requests to sign in by emailed link. */
export default async function SignInRequestsPage() {
  const session = await requireActiveSession();
  if (!canApproveSignIn(session)) forbidden();

  return <SignInRequestsScreen initial={await listSignInRequests()} />;
}
