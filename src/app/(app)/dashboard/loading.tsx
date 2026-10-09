import { Skeleton } from '@/components/ui/skeleton';

/** Shaped like the triage console, so the page does not jump when it arrives. */
export default function DashboardLoading() {
  return (
    <div className="space-y-8" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading the dashboard</span>
      <div className="space-y-2">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-80" />
      </div>
      <Skeleton className="h-44 w-full rounded-lg" />
      <div className="border-border overflow-hidden rounded-lg border">
        <Skeleton className="h-12 w-full rounded-none" />
        <Skeleton className="h-16 w-full rounded-none" />
        <Skeleton className="h-16 w-full rounded-none" />
        <Skeleton className="h-16 w-full rounded-none" />
      </div>
      <Skeleton className="h-24 w-full rounded-lg" />
    </div>
  );
}
