import Link from 'next/link';
import { AlertTriangle, CheckCircle2, Clock } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { formatDuration } from '@/lib/utils/duration';
import type { AttentionProblem, AttentionSubtask } from '@/lib/services/analytics';

/**
 * "Needs your attention" (build spec M8.3).
 *
 * Above the fold and before the charts, because these two lists are the only
 * part of the dashboard that asks the MD to do something today. A trend line is
 * for the end of the month; an unacknowledged blocker is for now.
 */
const SEVERITY_TONE: Record<string, string> = {
  BLOCKER: 'bg-state-overdue/10 text-state-overdue border-state-overdue/30',
  HIGH: 'bg-state-overdue/10 text-state-overdue border-state-overdue/30',
  MEDIUM: 'bg-state-problem/10 text-state-problem border-state-problem/30',
  LOW: 'bg-muted text-muted-foreground',
};

function age(hours: number): string {
  return formatDuration(hours * 60);
}

export function AttentionLists({
  problems,
  overdueSubtasks,
}: {
  problems: AttentionProblem[];
  overdueSubtasks: AttentionSubtask[];
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="rounded-lg border" aria-labelledby="attention-problems">
        <header className="flex items-center justify-between border-b px-4 py-3">
          <h2 id="attention-problems" className="flex items-center gap-2 text-sm font-semibold">
            <AlertTriangle className="text-state-problem size-4" />
            Problems waiting on you
          </h2>
          <Link href="/problems" className="text-muted-foreground hover:text-foreground text-xs">
            All problems
          </Link>
        </header>

        {problems.length === 0 ? (
          <Empty icon={CheckCircle2}>Nothing open. Every problem raised has been dealt with.</Empty>
        ) : (
          <ul className="divide-y">
            {problems.map((problem) => (
              <li key={problem.id}>
                <Link
                  href={`/problems?open=${problem.id}`}
                  className="hover:bg-accent/40 block px-4 py-3 transition-colors"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge
                      variant="outline"
                      className={cn('text-xs', SEVERITY_TONE[problem.severity])}
                    >
                      {problem.severity}
                    </Badge>
                    <span className="tabular text-xs font-medium">{problem.jobCode}</span>
                    <span className="text-muted-foreground text-xs">{problem.departmentName}</span>
                    <span className="text-muted-foreground tabular ml-auto text-xs">
                      {age(problem.ageHours)}
                    </span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-sm">{problem.description}</p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-lg border" aria-labelledby="attention-overdue">
        <header className="flex items-center justify-between border-b px-4 py-3">
          <h2 id="attention-overdue" className="flex items-center gap-2 text-sm font-semibold">
            <Clock className="text-state-overdue size-4" />
            Overdue subtasks
          </h2>
        </header>

        {overdueSubtasks.length === 0 ? (
          <Empty icon={CheckCircle2}>Nothing is past its deadline.</Empty>
        ) : (
          <ul className="divide-y">
            {overdueSubtasks.map((subtask) => (
              <li key={subtask.id}>
                <Link
                  href={`/jobs/${subtask.jobId}`}
                  className="hover:bg-accent/40 block px-4 py-3 transition-colors"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="tabular text-xs font-medium">{subtask.jobCode}</span>
                    <span className="text-muted-foreground text-xs">{subtask.departmentName}</span>
                    <span className="text-state-overdue tabular ml-auto text-xs font-semibold">
                      {age(subtask.overdueHours)} late
                    </span>
                  </div>
                  <p className="mt-1 truncate text-sm">{subtask.title}</p>
                  <p className="text-muted-foreground mt-0.5 text-xs">
                    {subtask.assigneeName}
                    {subtask.escalationCount > 0
                      ? ` · chased ${subtask.escalationCount}×`
                      : ' · not chased yet'}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Empty({ icon: Icon, children }: { icon: typeof CheckCircle2; children: React.ReactNode }) {
  return (
    <div className="text-muted-foreground flex flex-col items-center gap-2 px-4 py-10 text-center">
      <Icon className="text-state-complete size-6" />
      <p className="max-w-xs text-sm">{children}</p>
    </div>
  );
}
