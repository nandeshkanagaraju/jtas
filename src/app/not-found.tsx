import Link from 'next/link';

import { Button } from '@/components/ui/button';

/**
 * The 404.
 *
 * Reached most often by a job that was cancelled, or by a member following a
 * link to a job they hold no subtask on — `getJob` answers NOT_FOUND there
 * rather than FORBIDDEN, because confirming that a job code exists is itself
 * information. So the wording covers both without hinting at which it was.
 */
export default function NotFound() {
  return (
    <main className="bg-background flex min-h-dvh flex-col items-center justify-center gap-6 px-6 text-center">
      <div className="space-y-2">
        <p className="eyebrow">Error 404</p>
        <h1 className="page-title">That page is not here</h1>
        <p className="text-muted-foreground mx-auto max-w-md text-sm">
          The link may be out of date, or the job may have been cancelled. If somebody sent you this
          link, ask them for the job code and search for it.
        </p>
      </div>

      <div className="flex flex-wrap justify-center gap-2">
        <Button asChild>
          <Link href="/">Go to my home page</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/jobs">Search the jobs</Link>
        </Button>
      </div>
    </main>
  );
}
