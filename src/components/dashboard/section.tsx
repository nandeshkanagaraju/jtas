import Link from 'next/link';
import { ArrowRight } from 'lucide-react';

import { cn } from '@/lib/utils';
import { textClass, type Tone } from '@/lib/ui/tone';

/**
 * The one panel shape the dashboard uses.
 *
 * A heading bar with a count, a body, and an optional footer link to the full
 * list. Every block on the page is this, which is why the page reads as one
 * surface rather than as a pile of unrelated cards.
 */
export function Section({
  id,
  title,
  count,
  countTone = 'neutral',
  children,
  footer,
  className,
}: {
  id: string;
  title: string;
  /** Shop-wide total, which is usually larger than the rows shown. */
  count?: number;
  countTone?: Tone;
  children: React.ReactNode;
  footer?: { href: string; label: string };
  className?: string;
}) {
  return (
    <section
      aria-labelledby={id}
      className={cn('border-border bg-card flex flex-col rounded-lg border', className)}
    >
      <div className="border-border flex h-11 shrink-0 items-center justify-between gap-3 border-b px-4">
        <h2 id={id} className="font-display text-sm font-semibold">
          {title}
        </h2>
        {count === undefined ? null : (
          <span
            className={cn(
              'font-mono text-sm leading-none font-medium tabular-nums',
              count > 0 ? textClass(countTone) : 'text-muted-foreground',
            )}
          >
            {count}
          </span>
        )}
      </div>

      <div className="min-w-0 flex-1">{children}</div>

      {footer ? (
        <Link
          href={footer.href}
          className="border-border text-muted-foreground hover:text-foreground hover:bg-muted/60 flex items-center gap-1.5 border-t px-4 py-2.5 text-xs font-medium transition-colors"
        >
          {footer.label}
          <ArrowRight className="size-3.5" />
        </Link>
      ) : null}
    </section>
  );
}

/** What a list says when there is nothing in it. Never an illustration. */
export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-muted-foreground px-4 py-6 text-sm">{children}</p>;
}
