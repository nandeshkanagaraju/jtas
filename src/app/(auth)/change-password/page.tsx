import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { getSession } from '@/lib/auth/session';
import { T } from '@/lib/i18n/provider';

export const metadata: Metadata = { title: 'Password' };

/**
 * Passwords are set by the organisation and nobody changes their own, so this
 * page only explains that. The old form lives on in `change-password-form.tsx`
 * should self-service ever be reopened (see the API route).
 */
export default async function ChangePasswordPage() {
  const session = await getSession();

  // Middleware normally handles this; the check is repeated because a page must
  // never depend on middleware for access control (architecture rule 3).
  if (!session) redirect('/login');

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">
        <T>{'Passwords are set by the organisation'}</T>
      </h1>
      <p className="text-muted-foreground text-sm">
        <T>
          {
            'Your password cannot be changed from here. If you need a new one, ask the administrator.'
          }
        </T>
      </p>
      <Button asChild>
        <Link href="/">
          <T>{'Back to the app'}</T>
        </Link>
      </Button>
    </div>
  );
}
