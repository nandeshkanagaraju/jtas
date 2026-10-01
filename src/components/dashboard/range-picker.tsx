'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';
import { Loader2 } from 'lucide-react';

import { cn } from '@/lib/utils';
import { istDateKey } from '@/lib/utils/time';

/**
 * The date-range selector (build spec M8.3).
 *
 * Presets rather than two date fields: the MD's questions are "this month",
 * "last month", "this quarter". The range lives in the URL, so a bookmarked or
 * shared dashboard shows the same numbers to whoever opens it — and the server
 * component re-renders, which keeps the data fetch on the server.
 *
 * Drawn as one segmented control rather than four separate buttons, so it
 * reads as a single setting and takes one line beside a page title. The
 * selected range itself is a mono caption underneath, where it is available
 * without competing with the control.
 */
interface Preset {
  label: string;
  short: string;
  compute: (today: Date) => { from: string; to: string };
}

/** IST-day arithmetic, done on the UTC parts of an already-shifted date. */
function istToday(now: Date): Date {
  const key = istDateKey(now);
  const [year, month, day] = key.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function key(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function monthRange(anchor: Date, monthsBack: number) {
  const start = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() - monthsBack, 1));
  const end = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() - monthsBack + 1, 0));
  return { from: key(start), to: key(end) };
}

export const PRESETS: Preset[] = [
  {
    label: 'This month',
    short: 'Month',
    compute: (today) => monthRange(today, 0),
  },
  {
    label: 'Last month',
    short: 'Last',
    compute: (today) => monthRange(today, 1),
  },
  {
    label: 'Last 90 days',
    short: '90 days',
    compute: (today) => ({
      from: key(new Date(today.getTime() - 89 * 24 * 3_600_000)),
      to: key(today),
    }),
  },
  {
    label: 'This year',
    short: 'Year',
    compute: (today) => ({
      from: `${today.getUTCFullYear()}-01-01`,
      to: key(today),
    }),
  },
];

export function RangePicker({
  from,
  to,
  plain = false,
}: {
  from: string;
  to: string;
  /** Dashboard only: adds the resolved range as a caption under the control. */
  plain?: boolean;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  const today = istToday(new Date());

  function select(preset: Preset) {
    const next = preset.compute(today);
    const search = new URLSearchParams(params.toString());
    search.set('from', next.from);
    search.set('to', next.to);

    startTransition(() => router.push(`?${search.toString()}`));
  }

  const control = (
    <div
      role="group"
      aria-label="Date range"
      className="border-input bg-card inline-flex items-center gap-0.5 rounded-md border p-0.5"
    >
      {PRESETS.map((preset) => {
        const range = preset.compute(today);
        const active = range.from === from && range.to === to;

        return (
          <button
            key={preset.label}
            type="button"
            aria-pressed={active}
            onClick={() => select(preset)}
            disabled={pending}
            className={cn(
              'rounded-[5px] px-2.5 py-1.5 text-xs font-medium transition-colors disabled:opacity-50',
              active
                ? 'bg-foreground text-background'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            <span className="hidden sm:inline">{preset.label}</span>
            <span className="sm:hidden">{preset.short}</span>
          </button>
        );
      })}
    </div>
  );

  if (!plain) return control;

  return (
    <div className="flex flex-col items-start gap-1.5">
      {control}
      <p className="text-muted-foreground flex items-center gap-1.5 font-mono text-[11px] tabular-nums">
        {pending ? <Loader2 className="size-3 animate-spin" /> : null}
        {from} → {to}
        {pending ? <span className="sr-only">, updating</span> : null}
      </p>
    </div>
  );
}
