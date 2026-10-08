'use client';

import { Loader2, RotateCw, type LucideIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

/**
 * The four things a screen can be showing other than its content: loading,
 * empty, broken, or refused.
 *
 * All four used to be written out again on every screen, which is why one list
 * showed a centred spinner, the next showed nothing at all, and a third showed
 * "No subtasks yet" while it was still fetching them. They are components now
 * so that a screen has to choose one rather than forget.
 */

/**
 * Nothing here — and why.
 *
 * The distinction that matters is between "no rows exist" and "no rows match
 * your filters": the first wants an explanation, the second wants a way out.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon?: LucideIcon;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn('flex flex-col items-center gap-3 px-6 py-14 text-center', className)}
      data-slot="empty-state"
    >
      {Icon ? (
        <span className="border-border bg-muted/60 text-muted-foreground flex size-10 items-center justify-center rounded-full border">
          <Icon className="size-5" strokeWidth={1.75} />
        </span>
      ) : null}
      <div className="space-y-1">
        <p className="font-display font-semibold">{title}</p>
        {description ? (
          <p className="text-muted-foreground mx-auto max-w-sm text-sm">{description}</p>
        ) : null}
      </div>
      {action}
    </div>
  );
}

/**
 * A request that failed, with the way to try it again.
 *
 * `role="alert"` so a screen reader is told; a retry button because the honest
 * next step after "could not load" is almost always "load it again", and
 * making someone reload the whole page to get it loses their filters.
 */
export function ErrorState({
  title = 'That did not load',
  message,
  onRetry,
  className,
}: {
  title?: string;
  message: string;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={cn('flex flex-col items-center gap-3 px-6 py-14 text-center', className)}
    >
      <div className="space-y-1">
        <p className="font-display text-late font-semibold">{title}</p>
        <p className="text-muted-foreground mx-auto max-w-sm text-sm">{message}</p>
      </div>
      {onRetry ? (
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RotateCw className="size-4" />
          Try again
        </Button>
      ) : null}
    </div>
  );
}

/**
 * A table that has not arrived.
 *
 * Shaped like the rows it is standing in for, so the page does not jump when
 * they land — a spinner in an empty box moves everything below it twice.
 */
export function TableSkeleton({ rows = 6, columns = 4 }: { rows?: number; columns?: number }) {
  return (
    <div aria-hidden className="divide-border divide-y">
      {Array.from({ length: rows }, (_, row) => (
        <div key={row} className="flex items-center gap-4 px-4 py-3.5">
          {Array.from({ length: columns }, (_, column) => (
            <Skeleton
              key={column}
              className={cn('h-4', column === 0 ? 'w-40 flex-none' : 'min-w-0 flex-1')}
              style={{ opacity: 1 - row * 0.12 }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

/** The same idea for a stack of cards rather than a table. */
export function ListSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div aria-hidden className="space-y-3 p-4">
      {Array.from({ length: rows }, (_, row) => (
        <div key={row} className="space-y-2" style={{ opacity: 1 - row * 0.2 }}>
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-4 w-full max-w-md" />
        </div>
      ))}
    </div>
  );
}

/**
 * The in-place spinner, for a refresh of something already on screen.
 *
 * Never for a first load — that is what the skeletons above are for.
 */
export function Spinner({ label, className }: { label: string; className?: string }) {
  return (
    <span className={cn('text-muted-foreground inline-flex items-center gap-2 text-xs', className)}>
      <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />
      <span className="sr-only sm:not-sr-only">{label}</span>
    </span>
  );
}
