'use client';

import { T } from '@/lib/i18n/provider';

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
            <T>
              {
                'Try again. If it keeps happening, share the reference below with the administrator. If you were saving a change, check its status before submitting again. '
              }
            </T>
          </p>
          {error.digest ? (
            <p className="code mt-3 text-xs">
              <T>{'Reference '}</T>
              {error.digest}
            </p>
          ) : null}
        </>
      }
    >
      <Button onClick={reset}>
        <RotateCw className="size-4" />
        <T>{'Try again '}</T>
      </Button>
      <Button asChild variant="outline">
        <Link href="/">
          <T>{'Go to my home page'}</T>
        </Link>
      </Button>
    </SystemState>
  );
}
