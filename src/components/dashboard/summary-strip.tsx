import Link from 'next/link';

import { cn } from '@/lib/utils';
import { textClass, type Tone } from '@/lib/ui/tone';
import type { KpiCounts } from '@/lib/services/analytics';

/**
 * The six counts, as one strip of cells divided by hairlines.
 *
 * Each cell is a link, because a number the MD cannot open is a number he has
 * to go and look for. Colour is spent only where it means trouble: a cell
 * whose count is zero stays ink, so an at-risk count of 0 is never amber.
 *
 * Five of the six count the shop as it is right now. Only `Completed` is
 * scoped to the selected range, and it says so — a tile that silently answers
 * a different question to the one beside it is a trap.
 *
 * The hairlines are a 1px grid gap over a `--border` background rather than
 * per-cell borders, so they stay exact at every breakpoint.
 */

interface Cell {
  href: string;
  label: string;
  value: number;
  /** Omitted where a non-zero count is simply information, not a warning. */
  tone?: Tone;
  note?: string;
  scope?: string;
}

export function SummaryStrip({ kpis }: { kpis: KpiCounts }) {
  const cells: Cell[] = [
    { href: '/jobs?status=active', label: 'Active jobs', value: kpis.activeJobs },
    { href: '/jobs?status=AT_RISK', label: 'At risk', value: kpis.atRiskJobs, tone: 'risk' },
    { href: '/jobs?status=DELAYED', label: 'Delayed', value: kpis.delayedJobs, tone: 'late' },
    {
      href: '/jobs?filter=overdue',
      label: 'Overdue tasks',
      value: kpis.overdueSubtasks,
      tone: 'late',
    },
    {
      href: '/problems',
      label: 'Open problems',
      value: kpis.openProblems,
      tone: 'late',
      note:
        kpis.openProblemsOlderThan24h > 0 ? `${kpis.openProblemsOlderThan24h} over 24h` : undefined,
    },
    {
      href: '/jobs?status=COMPLETED',
      label: 'Completed',
      value: kpis.completedThisMonth,
      tone: 'ok',
      scope: 'in range',
    },
  ];

  return (
    <div className="border-border bg-border grid grid-cols-2 gap-px overflow-hidden rounded-lg border sm:grid-cols-3 xl:grid-cols-6">
      {cells.map((cell) => (
        <Link
          key={cell.href}
          href={cell.href}
          className="bg-card hover:bg-muted/60 px-4 py-3 transition-colors"
        >
          <p className="flex items-baseline gap-1.5">
            <span className="eyebrow truncate">{cell.label}</span>
            {cell.scope ? (
              <span className="text-muted-foreground shrink-0 text-[10px]">{cell.scope}</span>
            ) : null}
          </p>
          <p className="mt-2 flex items-baseline gap-2">
            <span
              className={cn(
                'metric',
                cell.tone && cell.value > 0 ? textClass(cell.tone) : 'text-foreground',
              )}
            >
              {cell.value}
            </span>
            {cell.note ? <span className="text-late text-xs font-medium">{cell.note}</span> : null}
          </p>
        </Link>
      ))}
    </div>
  );
}
