'use client';

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import type { TrendPoint } from '@/lib/services/analytics';
import { formatIST } from '@/lib/utils/time';

/**
 * Completed on time against completed late, over 30 days (build spec M8.3).
 *
 * A stacked bar rather than a percentage line: a day on which one subtask was
 * finished late reads as 0% on a line chart and looks identical to a day on
 * which forty were. The height carries the volume, the colour carries the
 * record.
 */
const ON_TIME = 'var(--state-complete)';
const LATE = 'var(--state-overdue)';

/** `2026-09-14` -> `14 Sep`. The keys are already IST days. */
function shortDay(day: string): string {
  const [year, month, date] = day.split('-').map(Number);
  return formatIST(new Date(Date.UTC(year, month - 1, date, 6)), 'd MMM');
}

export function OnTimeTrend({ trend }: { trend: TrendPoint[] }) {
  const total = trend.reduce((sum, point) => sum + point.onTime + point.late, 0);

  return (
    <section className="rounded-lg border" aria-labelledby="trend">
      <header className="border-b px-4 py-3">
        <h2 id="trend" className="text-sm font-semibold">
          Completed on time, last 30 days
        </h2>
        <p className="text-muted-foreground mt-0.5 text-xs">
          {total === 0 ? 'Nothing completed in this window.' : `${total} subtasks completed.`}
        </p>
      </header>

      <div className="p-2 sm:p-4">
        {/* Fixed height: ResponsiveContainer needs a bounded parent, and a
            percentage height inside an auto-height card collapses to zero. */}
        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={trend} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis
                dataKey="day"
                tickFormatter={shortDay}
                tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
                // Every fifth label, so thirty dates do not overlap into a smear.
                interval={4}
                tickLine={false}
                axisLine={{ stroke: 'var(--border)' }}
              />
              <YAxis
                allowDecimals={false}
                tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip
                cursor={{ fill: 'var(--accent)', opacity: 0.4 }}
                labelFormatter={(day) => shortDay(String(day))}
                contentStyle={{
                  background: 'var(--popover)',
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                  fontSize: 12,
                  color: 'var(--popover-foreground)',
                }}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              {/* Recharts animates over 1.5 s by default. On a page the MD
                  opens every morning that is a second and a half of the chart
                  not yet saying anything; 400 ms still reads as an entrance. */}
              <Bar
                dataKey="onTime"
                name="On time"
                stackId="a"
                fill={ON_TIME}
                animationDuration={400}
              />
              <Bar
                dataKey="late"
                name="Late"
                stackId="a"
                fill={LATE}
                radius={[3, 3, 0, 0]}
                animationDuration={400}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </section>
  );
}
