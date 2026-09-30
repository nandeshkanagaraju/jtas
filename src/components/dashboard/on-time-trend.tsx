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
 * Completed on time against completed late, over the last 30 days
 * (build spec M8.3).
 *
 * The range picker does not move this chart. A stacked bar rather than a
 * percentage line: a day on which one subtask was finished late reads as 0%
 * on a line chart and looks identical to a day on which forty were.
 *
 * No entrance animation. The chart draws because the page opened, not because
 * the MD did anything.
 */
const ON_TIME = '#d6f25a';
const LATE = '#fb7185';
const INK = '#f3f5f8';
const MUTE = '#aeb6c3';
const RULE = '#313743';

/** `2026-09-14` -> `14 Sep`. The keys are already IST days. */
function shortDay(day: string): string {
  const [year, month, date] = day.split('-').map(Number);
  return formatIST(new Date(Date.UTC(year, month - 1, date, 6)), 'd MMM');
}

export function OnTimeTrend({ trend }: { trend: TrendPoint[] }) {
  const total = trend.reduce((sum, point) => sum + point.onTime + point.late, 0);

  return (
    <section aria-labelledby="trend">
      <h2
        id="trend"
        className="border-b border-[#313743] py-3 text-sm font-semibold text-[#f3f5f8]"
      >
        Last 30 days
      </h2>
      <p className="mt-4 text-sm leading-6 text-[#aeb6c3]">
        {total === 0 ? 'Nothing completed in the last 30 days.' : `${total} completed.`}
      </p>

      <div className="mt-6 h-52 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={trend} margin={{ top: 4, right: 8, left: -12, bottom: 0 }}>
            <CartesianGrid stroke={RULE} vertical={false} />
            <XAxis
              dataKey="day"
              tickFormatter={shortDay}
              tick={{ fontSize: 14, fill: MUTE }}
              interval={4}
              tickLine={false}
              axisLine={{ stroke: RULE }}
            />
            <YAxis
              allowDecimals={false}
              tick={{ fontSize: 14, fill: MUTE }}
              tickLine={false}
              axisLine={false}
            />
            <Tooltip
              cursor={{ fill: RULE, opacity: 0.4 }}
              labelFormatter={(day) => shortDay(String(day))}
              contentStyle={{
                background: '#1e222b',
                border: `1px solid ${RULE}`,
                borderRadius: 2,
                fontSize: 14,
                color: INK,
              }}
            />
            <Legend wrapperStyle={{ fontSize: 14, color: MUTE }} />
            <Bar
              dataKey="onTime"
              name="On time"
              stackId="a"
              fill={ON_TIME}
              isAnimationActive={false}
            />
            <Bar dataKey="late" name="Late" stackId="a" fill={LATE} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
