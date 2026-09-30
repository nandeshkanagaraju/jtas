'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react';

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
  if (percent >= 90) return 'text-state-complete';
  if (percent >= 75) return 'text-foreground';
  return 'text-state-overdue';
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
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full min-w-[46rem] text-sm">
        <thead>
          <tr className="text-muted-foreground border-b text-xs">
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
              <td className="px-3 py-2.5">
                <Link href={`/reports?department=${row.departmentId}`} className="hover:underline">
                  <span className="font-medium">{row.name}</span>
                </Link>
              </td>
              <td
                className={cn(
                  'tabular px-3 py-2.5 text-right font-semibold',
                  rateTone(row.onTimePercent),
                )}
              >
                {row.onTimePercent === null ? '—' : `${row.onTimePercent}%`}
              </td>
              <td className="tabular px-3 py-2.5 text-right">
                {row.subtasksCompleted === 0 ? '—' : formatElapsed(row.averageDelayHours * 60)}
              </td>
              <td className="tabular px-3 py-2.5 text-right">{row.subtasksCompleted}</td>
              <td className="tabular px-3 py-2.5 text-right">{row.currentOpen}</td>
              <td className="tabular px-3 py-2.5 text-right">{row.problemsRaised}</td>
              <td
                className={cn(
                  'tabular px-3 py-2.5 text-right',
                  row.problemsWhereThisDepartmentWasTheRootCause > 0 &&
                    'text-state-problem font-medium',
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
                  'tabular px-3 py-2.5 text-right',
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
  );
}
