import { Skeleton } from '@/components/ui/skeleton';

/** Shaped like the job list, so the page does not jump when the rows arrive. */
export default function JobsLoading() {
  return (
    <div className="space-y-5" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading jobs</span>
      <div className="space-y-2">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-8 w-24" />
        <Skeleton className="h-4 w-80" />
      </div>
      <div className="border-border overflow-hidden rounded-lg border">
        {Array.from({ length: 6 }, (_, row) => (
          <div
            key={row}
            className="border-border flex flex-col gap-3 border-t px-4 py-3 first:border-t-0 md:flex-row md:items-center"
          >
            <div className="flex-1 space-y-2">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-4 w-56 max-w-full" />
            </div>
            <Skeleton className="h-2 w-40" />
            <Skeleton className="h-4 w-28" />
          </div>
        ))}
      </div>
    </div>
  );
}
