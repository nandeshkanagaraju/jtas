import { ArrowRight } from 'lucide-react';
import Link from 'next/link';

import { textClass, type Tone } from '@/lib/ui/tone';
import { cn } from '@/lib/utils';

/**
 * A block of content on the canvas.
 *
 * One shape, used everywhere: a card surface, a hairline, a heading bar with an
 * optional count or action, a body, and an optional footer link. The dashboard
 * invented this shape first; it lives here now because every other screen
 * needed it and was reinventing `rounded-lg border` with a different padding
 * each time.
 *
 * `flush` is for a body that is a table or a list of ruled rows, which supply
 * their own edges and must reach the panel's.
 */
export function Panel({
  title,
  id,
  count,
  countTone = 'neutral',
  description,
  action,
  footer,
  flush = false,
  className,
  bodyClassName,
  children,
}: {
  title?: React.ReactNode;
  /** Needed only when `title` is a node rather than a string. */
  id?: string;
  /** Shop-wide total, which is usually larger than the rows shown. */
  count?: number;
  countTone?: Tone;
  description?: React.ReactNode;
  /** A button or link in the heading bar, opposite the title. */
  action?: React.ReactNode;
  footer?: { href: string; label: string };
  flush?: boolean;
  className?: string;
  bodyClassName?: string;
  children: React.ReactNode;
}) {
  const headingId = id ?? (typeof title === 'string' ? slug(title) : undefined);

  return (
    <section
      aria-labelledby={title ? headingId : undefined}
      className={cn('border-border bg-card flex min-w-0 flex-col rounded-lg border', className)}
    >
      {title ? (
        <div
          className={cn(
            'border-border flex shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b px-4',
            description ? 'py-3' : 'min-h-11 py-2',
          )}
        >
          <div className="min-w-0">
            <h2 id={headingId} className="section-title">
              {title}
            </h2>
            {description ? (
              <p className="text-muted-foreground mt-0.5 text-xs">{description}</p>
            ) : null}
          </div>
          {action ??
            (count === undefined ? null : (
              <span
                className={cn(
                  'font-mono text-sm leading-none font-medium tabular-nums',
                  count > 0 ? textClass(countTone) : 'text-muted-foreground',
                )}
              >
                {count}
              </span>
            ))}
        </div>
      ) : null}

      <div className={cn('min-w-0 flex-1', !flush && 'p-4', bodyClassName)}>{children}</div>

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

function slug(text: string): string {
  return `panel-${text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')}`;
}
