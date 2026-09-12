import Link from 'next/link';

import { Button } from '@/components/ui/button';

/**
 * Rendered with a real 403 whenever a page calls `forbidden()` from
 * `next/navigation`. Deliberately says nothing about what the resource was —
 * the refusal must not itself leak information.
 */
export default function Forbidden() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 px-6 text-center">
      <div className="space-y-2">
        <p className="text-muted-foreground text-sm font-medium tracking-wide uppercase">
          Error 403
        </p>
        <h1 className="text-2xl font-semibold">You do not have access to this page</h1>
        <p className="text-muted-foreground mx-auto max-w-md text-sm">
          Your account does not have permission for this area. If you think that is wrong, ask the
          Managing Director or the system administrator.
        </p>
      </div>

      <Button asChild>
        <Link href="/">Go to my home page</Link>
      </Button>
    </main>
  );
}
