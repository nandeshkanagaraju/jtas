'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';
import { CalendarRange, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { istDateKey } from '@/lib/utils/time';

/**
 * The date-range selector (build spec M8.3).
 *
 * Presets rather than two date fields: the MD's questions are "this month",
 * "last month", "this quarter". The range lives in the URL, so a bookmarked or
 * shared dashboard shows the same numbers to whoever opens it — and the server
 * component re-renders, which keeps the data fetch on the server.
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
  /** Dashboard only. Reports keeps the compact control. */
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

  if (plain) {
    return (
      <div>
        <p className="font-mono text-sm text-[#aeb6c3]">
          {from} to {to}
          {pending ? ', updating' : ''}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
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
                  'min-h-11 rounded-lg border px-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d6f25a] disabled:opacity-50',
                  active
                    ? 'border-[#d6f25a] bg-[#d6f25a] text-[#14180a]'
                    : 'border-[#313743] bg-[#262b36] text-[#f3f5f8]',
                )}
              >
                {preset.label}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-muted-foreground flex items-center gap-1.5 text-xs">
        {pending ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <CalendarRange className="size-3.5" />
        )}
        <span className="tabular">
          {from} to {to}
        </span>
      </span>

      <div className="flex flex-wrap gap-1">
        {PRESETS.map((preset) => {
          const range = preset.compute(today);
          const active = range.from === from && range.to === to;

          return (
            <Button
              key={preset.label}
              size="sm"
              variant={active ? 'secondary' : 'ghost'}
              className={cn('h-7 px-2.5 text-xs', active && 'font-semibold')}
              aria-pressed={active}
              onClick={() => select(preset)}
              disabled={pending}
            >
              <span className="hidden sm:inline">{preset.label}</span>
              <span className="sm:hidden">{preset.short}</span>
            </Button>
          );
        })}
      </div>
    </div>
  );
}
