'use client';

import { CheckCircle2, Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
import { formatIST } from '@/lib/utils/time';

import { ProblemAge, ProblemStatusBadge, SeverityBadge } from './problem-badges';
import { ProblemDrawer } from './problem-drawer';

const ALL = '__all__';

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

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Problems</h1>
        <p className="text-muted-foreground text-sm">
          {counts.open + counts.acknowledged === 0
            ? 'Nothing is waiting on a decision.'
            : `${counts.open + counts.acknowledged} waiting on a decision${
                counts.stale > 0 ? `, ${counts.stale} for more than a day` : ''
              }.`}
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Select value={severity} onValueChange={setSeverity}>
          <SelectTrigger className="w-40" aria-label="Filter by severity">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All severities</SelectItem>
            {['BLOCKER', 'HIGH', 'MEDIUM', 'LOW'].map((value) => (
              <SelectItem key={value} value={value}>
                {value.charAt(0) + value.slice(1).toLowerCase()}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={departmentId} onValueChange={setDepartmentId}>
          <SelectTrigger className="w-44" aria-label="Filter by department">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All departments</SelectItem>
            {departments.map((department) => (
              <SelectItem key={department.id} value={department.id}>
                {department.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={ageBucket} onValueChange={setAgeBucket}>
          <SelectTrigger className="w-40" aria-label="Filter by age">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Any age</SelectItem>
            <SelectItem value="under2h">Under 2 hours</SelectItem>
            <SelectItem value="under24h">2 to 24 hours</SelectItem>
            <SelectItem value="over24h">Over a day</SelectItem>
          </SelectContent>
        </Select>

        <Select
          value={showClosed ? 'closed' : 'open'}
          onValueChange={(v) => setShowClosed(v === 'closed')}
        >
          <SelectTrigger className="w-44" aria-label="Filter by status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="open">Needs a decision</SelectItem>
            <SelectItem value="closed">Everything</SelectItem>
          </SelectContent>
        </Select>

        {loading ? <Loader2 className="text-muted-foreground mt-2 size-4 animate-spin" /> : null}
      </div>

      <div className="rounded-lg border">
        {data.data.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-16 text-center">
            <CheckCircle2 className="text-state-complete size-8" />
            <p className="font-medium">Nothing waiting on you</p>
            <p className="text-muted-foreground max-w-sm text-sm">
              Every problem raised has been dealt with. That is the number to keep at zero.
            </p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-20">Age</TableHead>
                <TableHead>Problem</TableHead>
                <TableHead className="hidden lg:table-cell">Deadline</TableHead>
                <TableHead className="hidden sm:table-cell">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.data.map((problem) => (
                <TableRow
                  key={problem.id}
                  onClick={() => {
                    setSelected(problem);
                    setDrawerOpen(true);
                  }}
                  className={cn(
                    'cursor-pointer',
                    // PDD section 12: older than a day is flagged red.
                    problem.isStale && 'bg-state-overdue/5',
                  )}
                >
                  <TableCell>
                    <ProblemAge ageHours={problem.ageHours} isStale={problem.isStale} />
                  </TableCell>

                  <TableCell>
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <SeverityBadge severity={problem.severity} />
                        <span className="tabular text-muted-foreground text-xs">
                          {problem.subtask.job.jobCode}
                        </span>
                        <span className="text-muted-foreground text-xs">
                          · {problem.subtask.department.name} · {problem.subtask.assignee.name}
                        </span>
                      </div>
                      <p className="line-clamp-2 max-w-xl text-sm">{problem.description}</p>
                      {/* Deadline and status fold in here on a narrow screen. */}
                      <p className="text-muted-foreground text-xs lg:hidden">
                        Due {formatIST(new Date(problem.subtask.deadline), 'dd MMM, hh:mm a')}
                      </p>
                    </div>
                  </TableCell>

                  <TableCell className="tabular hidden text-sm lg:table-cell">
                    {formatIST(new Date(problem.subtask.deadline))}
                  </TableCell>

                  <TableCell className="hidden sm:table-cell">
                    <ProblemStatusBadge status={problem.status} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

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
