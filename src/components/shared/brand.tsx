import { T } from '@/lib/i18n/provider';
import { cn } from '@/lib/utils';

export function Brand({ className, compact = false }: { className?: string; compact?: boolean }) {
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-2 sm:gap-2.5', className)}>
      <span className="brand-symbol" aria-hidden>
        <svg viewBox="0 0 32 32" fill="none">
          <path d="M5 7h8v18H5zM17 7h10v6H17zM17 17h10v8H17z" fill="currentColor" />
          <path d="M13 13h4v4h-4z" fill="currentColor" opacity=".45" />
        </svg>
      </span>
      {!compact ? (
        <span className="text-[20px] leading-none font-semibold tracking-[-0.065em] sm:text-[25px]">
          <T>{'Jaraa'}</T>
          <span className="text-action">/</span>
        </span>
      ) : null}
    </span>
  );
}
