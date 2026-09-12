import { cn } from '@/lib/utils';

/**
 * The JTAS wordmark. Intentionally plain — this is an internal tool, and the
 * login screen's job is to get someone onto the shop floor, not to sell.
 */
export function Brand({ className }: { className?: string }) {
  return (
    <div className={cn('flex flex-col items-center gap-1 text-center', className)}>
      <span className="text-2xl font-semibold tracking-tight">JTAS</span>
      <span className="text-muted-foreground text-xs">Jaraa Global Engineering Pvt Ltd</span>
    </div>
  );
}
