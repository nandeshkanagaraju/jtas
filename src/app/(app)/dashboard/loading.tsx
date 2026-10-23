import { T } from '@/lib/i18n/provider';
import { Skeleton } from '@/components/ui/skeleton';

export default function DashboardLoading() {
  return (
    <div className="space-y-8" aria-busy="true" aria-live="polite">
      <span className="sr-only">
        <T>{'Loading production overview'}</T>
      </span>
      <div className="space-y-3">
        <Skeleton className="h-3 w-48" />
        <Skeleton className="h-14 w-full max-w-xl" />
      </div>
      <div className="grid grid-cols-2 gap-5 border-y py-6 sm:grid-cols-3 lg:grid-cols-6">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="space-y-3">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-10 w-16" />
          </div>
        ))}
      </div>
      <Skeleton className="h-80 w-full rounded-[20px]" />
      <div className="space-y-4">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    </div>
  );
}
