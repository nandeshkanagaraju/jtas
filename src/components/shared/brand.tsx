import { cn } from '@/lib/utils';

/**
 * The JTAS wordmark, with the same mark the sidebar carries so that the sign-in
 * screen and the app read as one product. Intentionally plain beyond that —
 * this is an internal tool, and this screen's job is to get someone onto the
 * shop floor, not to sell.
 */
export function Brand({ className }: { className?: string }) {
  return (
    <div className={cn('flex flex-col items-center gap-3 text-center', className)}>
      <span className="bg-primary text-primary-foreground font-display inline-flex size-10 items-center justify-center rounded-lg text-lg font-bold">
        J
      </span>
      <span>
        <span className="font-display block text-xl font-semibold tracking-[-0.02em]">JTAS</span>
        <span className="text-muted-foreground mt-1 block text-xs">
          Jaraa Global Engineering Pvt Ltd
        </span>
      </span>
    </div>
  );
}
