'use client';

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import type { DepartmentScorecard } from '@/lib/services/analytics';

/**
 * On-time percentage by department (build spec M8.4).
 *
 * Departments that have completed nothing are left out rather than drawn as a
 * zero bar — an empty bar next to a genuinely failing one reads as the same
 * verdict, and it is not.
 */
const GOOD = 'var(--state-complete)';
const FAIR = 'var(--state-progress)';
const POOR = 'var(--state-overdue)';

function tone(percent: number): string {
  if (percent >= 90) return GOOD;
  if (percent >= 75) return FAIR;
  return POOR;
}

export function ScorecardChart({ rows }: { rows: DepartmentScorecard[] }) {
  const data = rows
    .filter((row) => row.onTimePercent !== null)
    .map((row) => ({
      name: row.name,
      percent: row.onTimePercent as number,
      completed: row.subtasksCompleted,
    }))
    .sort((a, b) => b.percent - a.percent);

  const silent = rows.filter((row) => row.onTimePercent === null);

  return (
    <section className="rounded-lg border" aria-labelledby="scorecard-chart">
      <header className="border-b px-4 py-3">
        <h2 id="scorecard-chart" className="text-sm font-semibold">
          On-time completion by department
        </h2>
        {silent.length > 0 ? (
          <p className="text-muted-foreground mt-0.5 text-xs">
            {silent.map((row) => row.name).join(', ')} completed nothing in this range.
          </p>
        ) : null}
      </header>

      <div className="p-2 sm:p-4">
        {data.length === 0 ? (
          <p className="text-muted-foreground py-10 text-center text-sm">
            No completed work in this range.
          </p>
        ) : (
          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={data}
                layout="vertical"
                margin={{ top: 4, right: 40, left: 8, bottom: 4 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
                <XAxis
                  type="number"
                  domain={[0, 100]}
                  unit="%"
                  tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
                  tickLine={false}
                  axisLine={{ stroke: 'var(--border)' }}
                />
                {/* Horizontal bars: eight department names will not fit side by
                    side on a phone, and rotated labels are unreadable. */}
                <YAxis
                  type="category"
                  dataKey="name"
                  width={92}
                  tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip
                  cursor={{ fill: 'var(--accent)', opacity: 0.4 }}
                  formatter={(value, _name, item) => [
                    `${value}% of ${item.payload.completed} completed`,
                    'On time',
                  ]}
                  contentStyle={{
                    background: 'var(--popover)',
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                    fontSize: 12,
                    color: 'var(--popover-foreground)',
                  }}
                />
                <Bar
                  dataKey="percent"
                  radius={[0, 3, 3, 0]}
                  maxBarSize={26}
                  animationDuration={400}
                >
                  {data.map((row) => (
                    <Cell key={row.name} fill={tone(row.percent)} />
                  ))}
                  <LabelList
                    dataKey="percent"
                    position="right"
                    formatter={(value: number) => `${value}%`}
                    style={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </section>
  );
}
