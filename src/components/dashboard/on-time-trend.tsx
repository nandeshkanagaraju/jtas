'use client';

import { T } from '@/lib/i18n/provider';

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

import type { TrendPoint } from '@/lib/services/analytics';
import { formatIST } from '@/lib/utils/time';

/**
 * Completed on time against completed late, over the last 30 days
 * (build spec M8.3).
 *
 * The range picker does not move this chart. A stacked bar rather than a
 * percentage line: a day on which one subtask was finished late reads as 0%
 * on a line chart and looks identical to a day on which forty were.
 *
 * Green is on time, red is late — the same two colours those words carry
 * everywhere else in the app. The legend is written out above the chart
 * instead of rendered by recharts, so it sits in the type scale of the page
 * rather than in the chart library's.
 *
 * No entrance animation. The chart draws because the page opened, not because
 * the MD did anything.
 */
const ON_TIME = 'var(--ok)';
const LATE = 'var(--late)';

/** `2026-09-14` -> `14 Sep`. The keys are already IST days. */
function shortDay(day: string): string {
  const [year, month, date] = day.split('-').map(Number);
  return formatIST(new Date(Date.UTC(year, month - 1, date, 6)), 'd MMM');
}

export function OnTimeTrend({
  trend,
  summary,
}: {
  trend: TrendPoint[];
  /** The on-time sentence for the selected range, shown above the chart. */
  summary: string;
}) {
  const total = trend.reduce((sum, point) => sum + point.onTime + point.late, 0);
  const late = trend.reduce((sum, point) => sum + point.late, 0);

  return (
    <section
      aria-labelledby="trend"
      className="product-panel border-border bg-card flex flex-col rounded-lg border"
    >
      <div className="border-border panel-heading flex min-h-16 shrink-0 flex-wrap items-center justify-between gap-x-4 border-b px-6">
        <h2 id="trend" className="font-display text-sm font-semibold">
          <T>{'Completion record '}</T>
        </h2>
        <p className="flex items-center gap-3 text-xs">
          <Key color="bg-ok" label="On time" />
          <Key color="bg-late" label="Late" />
        </p>
      </div>

      <div className="grid gap-6 p-5 sm:p-6 lg:grid-cols-[15rem_1fr]">
        <div className="flex flex-col border-b pb-6 lg:border-r lg:border-b-0 lg:pr-6 lg:pb-0">
          <p className="eyebrow">
            <T>{'Last 30 days'}</T>
          </p>
          <p className="mt-5 font-mono text-6xl tracking-[-.08em]">{total}</p>
          <p className="text-muted-foreground mt-2 text-sm">
            <T>{'department tasks completed'}</T>
          </p>
          <dl className="mt-6 flex gap-6 text-xs">
            <div>
              <dt className="text-muted-foreground">
                <T>{'On time'}</T>
              </dt>
              <dd className="text-ok mt-1 font-mono text-lg">{total - late}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">
                <T>{'Late'}</T>
              </dt>
              <dd className="text-late mt-1 font-mono text-lg">{late}</dd>
            </div>
          </dl>
          <p className="text-muted-foreground mt-6 border-t pt-4 text-xs leading-relaxed">
            <span className="text-foreground mb-1 block font-medium">
              <T>{'Selected period'}</T>
            </span>
            {summary}
          </p>
        </div>
        <div className="h-64 w-full min-w-0" aria-hidden>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={trend} margin={{ top: 4, right: 4, left: -18, bottom: 0 }}>
              <CartesianGrid stroke="var(--border)" vertical={false} strokeDasharray="3 5" />
              <XAxis
                dataKey="day"
                tickFormatter={shortDay}
                tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
                interval={6}
                tickLine={false}
                axisLine={{ stroke: 'var(--border)' }}
              />
              <YAxis
                allowDecimals={false}
                width={34}
                tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip
                cursor={{ fill: 'var(--muted)' }}
                labelFormatter={(day) => shortDay(String(day))}
                contentStyle={{
                  background: 'var(--card)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: 12,
                  color: 'var(--foreground)',
                  boxShadow: 'none',
                }}
              />
              <Bar
                dataKey="onTime"
                name="On time"
                stackId="a"
                fill={ON_TIME}
                maxBarSize={18}
                radius={[2, 2, 0, 0]}
                isAnimationActive={false}
              />
              <Bar
                dataKey="late"
                name="Late"
                stackId="a"
                fill={LATE}
                maxBarSize={18}
                radius={[2, 2, 0, 0]}
                isAnimationActive={false}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </section>
  );
}

function Key({ color, label }: { color: string; label: string }) {
  return (
    <span className="text-muted-foreground inline-flex items-center gap-1.5">
      <span aria-hidden className={`size-2 rounded-[2px] ${color}`} />
      <T>{label}</T>
    </span>
  );
}
