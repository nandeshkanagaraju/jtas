'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react';

import { Panel } from '@/components/shared/panel';
import { cn } from '@/lib/utils';
import { formatElapsed } from '@/lib/utils/duration';
import type { DepartmentScorecard } from '@/lib/services/analytics';

/**
 * The department scorecard table (build spec M8.4).
 *
 * Sorting is client-side because the whole table is eight rows: a round trip to
 * re-order eight rows would be slower than the render and would lose the
 * reader's place.
 */
type SortKey = keyof Pick<
  DepartmentScorecard,
  | 'name'
  | 'onTimePercent'
  | 'averageDelayHours'
  | 'subtasksCompleted'
  | 'currentOpen'
  | 'problemsRaised'
  | 'problemsWhereThisDepartmentWasTheRootCause'
  | 'extensionCount'
>;

interface ColumnDef {
  key: SortKey;
  label: string;
  short?: string;
  numeric?: boolean;
  help?: string;
}

const COLUMNS: ColumnDef[] = [
  { key: 'name', label: 'Department' },
  { key: 'onTimePercent', label: 'On time', numeric: true },
  { key: 'averageDelayHours', label: 'Avg delay', short: 'Delay', numeric: true },
  { key: 'subtasksCompleted', label: 'Completed', numeric: true },
  { key: 'currentOpen', label: 'Open now', short: 'Open', numeric: true },
  {
    key: 'problemsRaised',
    label: 'Problems raised',
    short: 'Raised',
    numeric: true,
    help: 'Every problem reported on this department’s subtasks — not a fault in itself',
  },
  {
    key: 'problemsWhereThisDepartmentWasTheRootCause',
    label: 'Blocked others',
    short: 'Blocked',
    numeric: true,
    help: 'Of those, the ones on a subtask another subtask was waiting on — where the delay spread',
  },
  {
    key: 'extensionCount',
    label: 'Extensions',
    short: 'Ext.',
    numeric: true,
    help: 'Times a deadline in this department was moved',
  },
];

/** Colours the on-time figure. Null is not a failing grade. */
function rateTone(percent: number | null): string {
  if (percent === null) return 'text-muted-foreground';
  if (percent >= 90) return 'text-ok';
  if (percent >= 75) return 'text-foreground';
  return 'text-late';
}

export function ScorecardTable({ rows }: { rows: DepartmentScorecard[] }) {
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({
    key: 'onTimePercent',
    desc: true,
  });

  const sorted = [...rows].sort((a, b) => {
    const left = a[sort.key];
    const right = b[sort.key];

    if (typeof left === 'string' || typeof right === 'string') {
      return String(left).localeCompare(String(right)) * (sort.desc ? -1 : 1);
    }

    /*
     * A department with no completed work sorts last whichever way the column
     * is pointing. Treating its null rate as 0 would rank it below one that is
     * genuinely missing deadlines, and as 100 would put it top of the table.
     */
    if (left === null && right === null) return 0;
    if (left === null) return 1;
    if (right === null) return -1;

    return (Number(left) - Number(right)) * (sort.desc ? -1 : 1);
  });

  function toggle(key: SortKey) {
    setSort((current) =>
      current.key === key ? { key, desc: !current.desc } : { key, desc: key !== 'name' },
    );
  }

  return (
    <Panel
      title="Department scorecards"
      description="On-time rate first. A department that completed nothing in the range shows a dash rather than a zero."
      flush
    >
      <div className="p-4 xl:hidden">
        <label className="text-muted-foreground mb-4 flex flex-wrap items-center gap-2 text-xs">
          Sort scorecards
          <select
            aria-label="Sort scorecards"
            value={sort.key}
            onChange={(event) =>
              setSort({ key: event.target.value as SortKey, desc: event.target.value !== 'name' })
            }
            className="border-input bg-card text-foreground min-h-10 rounded-lg border px-3 text-sm"
          >
            {COLUMNS.map((column) => (
              <option key={column.key} value={column.key}>
                {column.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => toggle(sort.key)}
            className="border-input text-foreground min-h-10 rounded-lg border px-3 text-sm"
          >
            {sort.desc ? 'Highest first ↓' : 'Lowest first ↑'}
          </button>
        </label>
        <ul className="grid gap-4 md:grid-cols-2">
          {sorted.map((row) => (
            <li
              key={row.departmentId}
              className="border-border bg-background/60 rounded-xl border p-4"
            >
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-base font-semibold">{row.name}</h3>
                <span className={cn('font-mono text-xl font-medium', rateTone(row.onTimePercent))}>
                  {row.onTimePercent === null ? '—' : `${row.onTimePercent}%`}
                  <span className="text-muted-foreground ml-1.5 font-sans text-xs">on time</span>
                </span>
              </div>
              <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3">
                {COLUMNS.filter(
                  (column) => column.key !== 'name' && column.key !== 'onTimePercent',
                ).map((column) => (
                  <div key={column.key}>
                    <dt className="text-muted-foreground text-xs">{column.label}</dt>
                    <dd className="mt-1 font-mono text-sm">
                      {column.key === 'averageDelayHours'
                        ? row.subtasksCompleted === 0
                          ? '—'
                          : formatElapsed(row.averageDelayHours * 60)
                        : row[column.key]}
                    </dd>
                  </div>
                ))}
              </dl>
            </li>
          ))}
        </ul>
      </div>
      <div className="hidden overflow-x-auto xl:block">
        <table className="w-full min-w-[46rem] text-sm">
          <thead>
            <tr className="text-muted-foreground border-rule border-b text-xs">
              {COLUMNS.map((column) => {
                const active = sort.key === column.key;
                const Icon = !active ? ChevronsUpDown : sort.desc ? ArrowDown : ArrowUp;

                return (
                  <th
                    key={column.key}
                    scope="col"
                    className={cn(
                      'px-3 py-2 font-medium',
                      column.numeric ? 'text-right' : 'text-left',
                    )}
                    title={column.help}
                    aria-sort={active ? (sort.desc ? 'descending' : 'ascending') : 'none'}
                  >
                    <button
                      type="button"
                      onClick={() => toggle(column.key)}
                      className={cn(
                        'hover:text-foreground inline-flex items-center gap-1 transition-colors',
                        column.numeric && 'flex-row-reverse',
                        active && 'text-foreground font-semibold',
                      )}
                    >
                      <Icon className="size-3" />
                      <span className="hidden sm:inline">{column.label}</span>
                      <span className="sm:hidden">{column.short ?? column.label}</span>
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>

          <tbody className="divide-y">
            {sorted.map((row) => (
              <tr key={row.departmentId} className="hover:bg-accent/40 transition-colors">
                <td className="py-2.5 pr-3 pl-4">
                  <Link
                    href={`/reports?department=${row.departmentId}`}
                    className="hover:underline"
                  >
                    <span className="font-medium">{row.name}</span>
                  </Link>
                </td>
                <td
                  className={cn(
                    'code px-3 py-2.5 text-right font-semibold',
                    rateTone(row.onTimePercent),
                  )}
                >
                  {row.onTimePercent === null ? '—' : `${row.onTimePercent}%`}
                </td>
                <td className="code px-3 py-2.5 text-right">
                  {row.subtasksCompleted === 0 ? '—' : formatElapsed(row.averageDelayHours * 60)}
                </td>
                <td className="code px-3 py-2.5 text-right">{row.subtasksCompleted}</td>
                <td className="code px-3 py-2.5 text-right">{row.currentOpen}</td>
                <td className="code px-3 py-2.5 text-right">{row.problemsRaised}</td>
                <td
                  className={cn(
                    'code px-3 py-2.5 text-right',
                    row.problemsWhereThisDepartmentWasTheRootCause > 0 && 'text-risk font-medium',
                  )}
                >
                  {row.problemsWhereThisDepartmentWasTheRootCause}
                  {/* The denominator, so the two columns read as a subset rather
                    than two unrelated counts. Raising problems is not a fault;
                    blocking the next bench is the number that matters. */}
                  {row.problemsRaised > 0 ? (
                    <span className="text-muted-foreground ml-1 text-xs font-normal">
                      /{row.problemsRaised}
                    </span>
                  ) : null}
                </td>
                <td
                  className={cn(
                    'code px-3 py-2.5 text-right',
                    row.extensionCount > 0 && 'text-muted-foreground',
                  )}
                >
                  {row.extensionCount}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
