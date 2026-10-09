import { Skeleton } from '@/components/ui/skeleton';

/** Shaped like the job: facts, then the relay. */
export default function JobLoading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading the job</span>
      <div className="space-y-2">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-8 w-72 max-w-full" />
        <Skeleton className="h-4 w-48" />
      </div>
      <Skeleton className="h-28 w-full rounded-lg" />
      <div className="space-y-2">
        {Array.from({ length: 6 }, (_, row) => (
          <Skeleton key={row} className="h-14 w-full" />
        ))}
      </div>
    </div>
  );
}
