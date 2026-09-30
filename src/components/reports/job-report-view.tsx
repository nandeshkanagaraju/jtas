import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { JobReport } from '@/lib/services/reports';
import { formatDuration } from '@/lib/utils/duration';
import { formatIST } from '@/lib/utils/time';

/**
 * One job in full: the subtask chain with planned against actual, and every
 * problem raised (build spec M8.4).
 *
 * This is the page somebody prints when a customer asks why a job was three
 * weeks late — so every row shows the deadline, the completion and the gap,
 * rather than a status that has already moved on.
 */
const SEVERITY_TONE: Record<string, string> = {
  BLOCKER: 'bg-state-overdue/10 text-state-overdue border-state-overdue/30',
  HIGH: 'bg-state-overdue/10 text-state-overdue border-state-overdue/30',
  MEDIUM: 'bg-state-problem/10 text-state-problem border-state-problem/30',
  LOW: 'bg-muted text-muted-foreground',
};

const ist = (date: Date | string | null) => (date ? formatIST(new Date(date)) : '—');

export function JobReportView({ report }: { report: JobReport }) {
  const finished = report.subtasks.filter((subtask) => subtask.actualCompletion).length;
  const late = report.subtasks.filter((subtask) => subtask.delayHours > 0).length;

  /*
   * "Every step met its deadline" is only true of steps that have finished.
   * Saying it about a job where nothing is done yet reads as a clean record
   * when there is no record at all.
   */
  const verdict =
    finished === 0
      ? 'Nothing completed yet.'
      : late === 0
        ? `All ${finished} completed steps met their deadline.`
        : `${late} of ${finished} completed steps were late.`;

  return (
    <div className="space-y-4">
      <section className="rounded-lg border">
        <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b px-4 py-3">
          <h2 className="tabular text-base font-semibold">{report.job.jobCode}</h2>
          <p className="text-muted-foreground text-sm">{report.job.title}</p>
          <Badge variant="outline" className="ml-auto text-xs">
            {report.job.status}
          </Badge>
        </header>

        <dl className="grid gap-x-6 gap-y-2 px-4 py-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
          <Fact label="Customer" value={report.job.customerName ?? '—'} />
          <Fact
            label="Part / drawing"
            value={
              [report.job.partNumber, report.job.drawingNumber].filter(Boolean).join(' / ') || '—'
            }
          />
          <Fact
            label="Quantity"
            value={report.job.quantity === null ? '—' : String(report.job.quantity)}
          />
          <Fact label="Priority" value={report.job.priority} />
          <Fact label="Overall deadline" value={ist(report.job.overallDeadline)} />
          <Fact label="Completed" value={ist(report.job.completedAt)} />
        </dl>
      </section>

      <section className="rounded-lg border" aria-labelledby="chain">
        <header className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
          <h3 id="chain" className="text-sm font-semibold">
            Subtask chain ({report.subtasks.length})
          </h3>
          <p className="text-muted-foreground text-xs">{verdict}</p>
        </header>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[48rem] text-sm">
            <thead>
              <tr className="text-muted-foreground border-b text-left text-xs">
                <th className="px-4 py-2 font-medium">Department</th>
                <th className="px-4 py-2 font-medium">Subtask</th>
                <th className="px-4 py-2 font-medium">Assignee</th>
                <th className="px-4 py-2 font-medium">Planned</th>
                <th className="px-4 py-2 font-medium">Actual</th>
                <th className="px-4 py-2 text-right font-medium">Delay</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {report.subtasks.map((subtask, index) => (
                <tr key={`${subtask.title}-${index}`} className="hover:bg-accent/40">
                  <td className="px-4 py-2.5 font-medium">{subtask.department}</td>
                  <td className="px-4 py-2.5">
                    {subtask.title}
                    {subtask.extensions > 0 ? (
                      // Shown inline: a step that met a deadline it moved twice
                      // is not the same as one that met the original.
                      <span className="text-muted-foreground ml-2 text-xs">
                        · {subtask.extensions} extension{subtask.extensions > 1 ? 's' : ''}
                      </span>
                    ) : null}
                  </td>
                  <td className="text-muted-foreground px-4 py-2.5">{subtask.assignee}</td>
                  <td className="tabular px-4 py-2.5 text-xs">{ist(subtask.plannedDeadline)}</td>
                  <td className="tabular px-4 py-2.5 text-xs">
                    {subtask.actualCompletion ? (
                      ist(subtask.actualCompletion)
                    ) : (
                      <span className="text-muted-foreground">{subtask.status}</span>
                    )}
                  </td>
                  <td
                    className={cn(
                      'tabular px-4 py-2.5 text-right',
                      subtask.delayHours > 0 && 'text-state-overdue font-semibold',
                    )}
                  >
                    {subtask.actualCompletion ? formatDuration(subtask.delayHours * 60) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-lg border" aria-labelledby="job-problems">
        <header className="border-b px-4 py-3">
          <h3 id="job-problems" className="text-sm font-semibold">
            Problems ({report.problems.length})
          </h3>
        </header>

        {report.problems.length === 0 ? (
          <p className="text-muted-foreground px-4 py-8 text-center text-sm">
            No problems were raised on this job.
          </p>
        ) : (
          <ul className="divide-y">
            {report.problems.map((problem, index) => (
              <li key={`${problem.raisedAt}-${index}`} className="px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge
                    variant="outline"
                    className={cn('text-xs', SEVERITY_TONE[problem.severity])}
                  >
                    {problem.severity}
                  </Badge>
                  <span className="text-xs font-medium">{problem.department}</span>
                  <span className="text-muted-foreground truncate text-xs">
                    {problem.subtaskTitle}
                  </span>
                  <span className="text-muted-foreground tabular ml-auto text-xs">
                    {ist(problem.raisedAt)}
                  </span>
                </div>

                <p className="mt-1.5 text-sm">{problem.description}</p>

                {problem.resolution ? (
                  <p className="text-muted-foreground mt-1 border-l-2 pl-3 text-sm">
                    <span className="font-medium">Resolved {ist(problem.resolvedAt)}:</span>{' '}
                    {problem.resolution}
                  </p>
                ) : (
                  <p className="text-state-problem mt-1 text-xs">Still open.</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}
