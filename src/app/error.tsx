'use client';

import { RotateCw, Unplug } from 'lucide-react';
import Link from 'next/link';
import { useEffect } from 'react';
import { SystemState } from '@/components/shared/system-state';
import { Button } from '@/components/ui/button';

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <SystemState
      code="Something broke"
      icon={Unplug}
      title="This screen did not load"
      description={
        <>
          <p>
            Try again. If it keeps happening, share the reference below with the administrator. If
            you were saving a change, check its status before submitting again.
          </p>
          {error.digest ? <p className="code mt-3 text-xs">Reference {error.digest}</p> : null}
        </>
      }
    >
      <Button onClick={reset}>
        <RotateCw className="size-4" />
        Try again
      </Button>
      <Button asChild variant="outline">
        <Link href="/">Go to my home page</Link>
      </Button>
    </SystemState>
  );
}
