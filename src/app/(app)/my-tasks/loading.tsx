import { Skeleton } from '@/components/ui/skeleton';

/** Shaped like one task and the folded counts, not a spinner in an empty box. */
export default function MyTasksLoading() {
  return (
    <div className="mx-auto max-w-3xl space-y-6" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading your tasks</span>
      <div className="space-y-2">
        <Skeleton className="h-4 w-36" />
        <Skeleton className="h-5 w-48" />
      </div>
      <div className="border-border space-y-3 rounded-lg border p-4">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-5 w-56" />
        <Skeleton className="h-12 w-full" />
      </div>
      <div className="flex flex-wrap gap-2">
        <Skeleton className="h-11 min-w-[9.5rem] flex-1" />
        <Skeleton className="h-11 min-w-[9.5rem] flex-1" />
        <Skeleton className="h-11 min-w-[9.5rem] flex-1" />
      </div>
    </div>
  );
}
