'use client';

import { RotateCw } from 'lucide-react';
import Link from 'next/link';
import { useEffect } from 'react';

import { Button } from '@/components/ui/button';

/**
 * The last resort: an unhandled error anywhere under the app shell.
 *
 * Next's own error page is unstyled and says nothing useful, which on an
 * internal tool reads as "the system is broken, stop working". This one offers
 * the two things that actually help — try again, or go back to your own
 * screen — and names the digest so a report to the administrator can be
 * matched against the server log.
 *
 * `reset()` re-renders the segment without a full reload, so a transient
 * failure costs nothing.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Sentry's Next.js integration captures this automatically; the console
    // line is for a developer running the app locally without it.
    console.error(error);
  }, [error]);

  return (
    <main className="bg-background flex min-h-dvh flex-col items-center justify-center gap-6 px-6 text-center">
      <div className="space-y-2">
        <p className="eyebrow">Something broke</p>
        <h1 className="page-title">This screen did not load</h1>
        <p className="text-muted-foreground mx-auto max-w-md text-sm">
          Nothing you did was lost — JTAS does not record a change unless it tells you it has. Try
          again, and if it keeps happening tell the administrator.
        </p>
        {error.digest ? (
          <p className="text-muted-foreground text-xs">
            Reference <span className="code">{error.digest}</span>
          </p>
        ) : null}
      </div>

      <div className="flex flex-wrap justify-center gap-2">
        <Button onClick={reset}>
          <RotateCw className="size-4" />
          Try again
        </Button>
        <Button asChild variant="outline">
          <Link href="/">Go to my home page</Link>
        </Button>
      </div>
    </main>
  );
}
