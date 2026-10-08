'use client';

import { CheckCircle2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { PageHeader } from '@/components/shared/page-header';
import { Panel } from '@/components/shared/panel';
import { EmptyState, Spinner, TableSkeleton } from '@/components/shared/states';
import {
  ActiveFilters,
  FilterSelect,
  Toolbar,
  type ActiveFilter,
} from '@/components/shared/toolbar';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ApiError } from '@/lib/api/client';
import { fetchProblems, type ProblemDto, type ProblemInboxDto } from '@/lib/api/problems-client';
import type { UserRow } from '@/lib/api/users-client';
import type { DepartmentSummary } from '@/lib/services/department-service';
import { cn } from '@/lib/utils';
import { formatElapsed } from '@/lib/utils/duration';
import { formatIST } from '@/lib/utils/time';

import { ProblemAge, ProblemStatusBadge, SeverityBadge } from './problem-badges';
import { ProblemDrawer } from './problem-drawer';

const ALL = '__all__';

/** The status column is hidden on a phone, so the word folds into the row. */
const STATUS_WORD: Record<string, string> = {
  OPEN: 'Open',
  ACKNOWLEDGED: 'Seen',
  RESOLVED: 'Resolved',
  REJECTED: 'Rejected',
};

const SEVERITIES = [
  { value: 'BLOCKER', label: 'Blocker' },
  { value: 'HIGH', label: 'High' },
  { value: 'MEDIUM', label: 'Medium' },
  { value: 'LOW', label: 'Low' },
];

const AGES = [
  { value: 'under2h', label: 'Under 2 hours' },
  { value: 'under24h', label: '2 to 24 hours' },
  { value: 'over24h', label: 'Over a day' },
];

export function ProblemsScreen({
  initial,
  departments,
  candidates,
}: {
  initial: ProblemInboxDto;
  departments: DepartmentSummary[];
  candidates: UserRow[];
}) {
  const router = useRouter();
  const [data, setData] = useState(initial);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<ProblemDto | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const [severity, setSeverity] = useState<string>(ALL);
  const [departmentId, setDepartmentId] = useState<string>(ALL);
  const [ageBucket, setAgeBucket] = useState<string>(ALL);
  const [showClosed, setShowClosed] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(
        await fetchProblems({
          severity: severity === ALL ? undefined : (severity as never),
          departmentId: departmentId === ALL ? undefined : departmentId,
          ageBucket: ageBucket === ALL ? undefined : (ageBucket as never),
          open: !showClosed,
        }),
      );
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Could not load the inbox.');
    } finally {
      setLoading(false);
    }
  }, [severity, departmentId, ageBucket, showClosed]);

  useEffect(() => {
    void load();
  }, [load]);

  const { counts } = data;
  const waiting = counts.open + counts.acknowledged;

  const active = useMemo<ActiveFilter[]>(() => {
    const chips: ActiveFilter[] = [];
    if (severity !== ALL) {
      chips.push({
        key: 'severity',
        label: SEVERITIES.find((s) => s.value === severity)?.label ?? severity,
        onClear: () => setSeverity(ALL),
      });
    }
    if (departmentId !== ALL) {
      chips.push({
        key: 'department',
        label: departments.find((d) => d.id === departmentId)?.name ?? 'Department',
        onClear: () => setDepartmentId(ALL),
      });
    }
    if (ageBucket !== ALL) {
      chips.push({
        key: 'age',
        label: AGES.find((a) => a.value === ageBucket)?.label ?? ageBucket,
        onClear: () => setAgeBucket(ALL),
      });
    }
    if (showClosed) {
      chips.push({
        key: 'closed',
        label: 'Including decided',
        onClear: () => setShowClosed(false),
      });
    }
    return chips;
  }, [severity, departmentId, ageBucket, showClosed, departments]);

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Waiting on a decision"
        title="Problems"
        lead={lead(waiting, counts.stale)}
        actions={loading ? <Spinner label="Refreshing" /> : null}
      >
        <div className="space-y-3">
          <Toolbar label="Filter problems">
            <FilterSelect
              value={severity}
              onChange={setSeverity}
              options={SEVERITIES}
              allValue={ALL}
              allLabel="All severities"
              label="Filter by severity"
            />
            <FilterSelect
              value={departmentId}
              onChange={setDepartmentId}
              options={departments.map((d) => ({ value: d.id, label: d.name }))}
              allValue={ALL}
              allLabel="All departments"
              label="Filter by department"
            />
            <FilterSelect
              value={ageBucket}
              onChange={setAgeBucket}
              options={AGES}
              allValue={ALL}
              allLabel="Any age"
              label="Filter by age"
            />
            <FilterSelect
              value={showClosed ? 'closed' : 'open'}
              onChange={(value) => setShowClosed(value === 'closed')}
              options={[{ value: 'closed', label: 'Everything, decided included' }]}
              allValue="open"
              allLabel="Needs a decision"
              label="Filter by status"
            />
          </Toolbar>
          <ActiveFilters
            filters={active}
            onClearAll={() => {
              setSeverity(ALL);
              setDepartmentId(ALL);
              setAgeBucket(ALL);
              setShowClosed(false);
            }}
            resultLabel={`${data.data.length} ${data.data.length === 1 ? 'report' : 'reports'}`}
          />
        </div>
      </PageHeader>

      <Panel flush>
        {loading && data.data.length === 0 ? (
          <TableSkeleton rows={4} columns={4} />
        ) : data.data.length === 0 ? (
          <EmptyState
            icon={CheckCircle2}
            title={active.length > 0 ? 'Nothing matches these filters' : 'Nothing waiting on you'}
            description={
              active.length > 0
                ? 'Clear a filter above to see the rest of the inbox.'
                : 'Every problem raised has been dealt with. That is the number to keep at zero.'
            }
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="border-rule hover:bg-transparent">
                <TableHead className="hidden w-28 pl-4 sm:table-cell">Waiting</TableHead>
                <TableHead className="pl-4 sm:pl-2">Problem</TableHead>
                <TableHead className="hidden lg:table-cell">Task deadline</TableHead>
                <TableHead className="hidden pr-4 sm:table-cell">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.data.map((problem) => (
                <TableRow
                  key={problem.id}
                  /*
                   * Clicking anywhere on the row is a convenience for a mouse.
                   * The row keeps its `row` role — the keyboard path is the
                   * real button inside the cell below, because a `<tr>` with
                   * role="button" stops being a row for a screen reader (and
                   * for the end-to-end suite, which reads this table by role).
                   */
                  onClick={() => {
                    setSelected(problem);
                    setDrawerOpen(true);
                  }}
                  className={cn(
                    'cursor-pointer',
                    // PDD section 12: older than a day is flagged red. The rule
                    // on the leading edge carries it without tinting the row,
                    // which stays readable when several rows are stale at once.
                    problem.isStale && 'border-l-late border-l-[3px]',
                  )}
                >
                  <TableCell
                    className={cn(
                      'hidden py-3.5 align-top sm:table-cell',
                      problem.isStale ? 'pl-[13px]' : 'pl-4',
                    )}
                  >
                    <ProblemAge ageHours={problem.ageHours} isStale={problem.isStale} />
                  </TableCell>

                  <TableCell
                    className={cn(
                      'py-3.5 align-top whitespace-normal sm:pl-2',
                      problem.isStale ? 'pl-[13px] sm:pl-2' : 'pl-4',
                    )}
                  >
                    <button
                      type="button"
                      onClick={(event) => {
                        // The row handler would otherwise run a second time.
                        event.stopPropagation();
                        setSelected(problem);
                        setDrawerOpen(true);
                      }}
                      aria-label={`Decide the ${problem.severity.toLowerCase()} problem on ${problem.subtask.job.jobCode}`}
                      className="w-full space-y-1.5 text-left"
                    >
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <SeverityBadge severity={problem.severity} />
                        <span className="code text-muted-foreground text-xs">
                          {problem.subtask.job.jobCode}
                        </span>
                        <span className="text-muted-foreground text-xs">
                          · {problem.subtask.department.name} · {problem.subtask.assignee.name}
                        </span>
                      </div>
                      <p className="line-clamp-2 max-w-xl text-sm">{problem.description}</p>
                      {/* Age, deadline and status fold in here on a narrow screen. */}
                      <p className="text-muted-foreground flex flex-wrap items-center gap-x-2 text-xs lg:hidden">
                        <span
                          className={cn('sm:hidden', problem.isStale && 'text-late font-medium')}
                        >
                          Waiting {formatElapsed(problem.ageHours * 60)} ·
                        </span>
                        <span>
                          {problem.subtask.deadline
                            ? `Task due ${formatIST(new Date(problem.subtask.deadline), 'dd MMM, hh:mm a')}`
                            : 'No date yet'}
                        </span>
                        <span className="sm:hidden">· {STATUS_WORD[problem.status]}</span>
                      </p>
                    </button>
                  </TableCell>

                  <TableCell className="code hidden align-top text-sm lg:table-cell">
                    {problem.subtask.deadline
                      ? formatIST(new Date(problem.subtask.deadline))
                      : 'No date yet'}
                  </TableCell>

                  <TableCell className="hidden pr-4 align-top sm:table-cell">
                    <ProblemStatusBadge status={problem.status} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Panel>

      <ProblemDrawer
        problem={selected}
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        departments={departments}
        candidates={candidates}
        onResolved={async (message) => {
          toast.success(message);
          // The row leaves the inbox on the next load…
          await load();
          // …and the nav badge is server-rendered in the layout, so it needs a
          // refresh too. A count that does not go down is exactly the pressure
          // this badge exists to apply, and a stale one destroys that.
          router.refresh();
        }}
      />
    </div>
  );
}

/** One sentence of state: how many, and how long the worst has been sitting. */
function lead(waiting: number, stale: number): string {
  if (waiting === 0) return 'Nothing is waiting on a decision.';
  const body = `${waiting} ${waiting === 1 ? 'report is' : 'reports are'} waiting on you`;
  if (stale > 0) {
    return `${body} — ${stale} ${stale === 1 ? 'has' : 'have'} been waiting more than a day.`;
  }
  return `${body}. Open one to decide it.`;
}
