import Link from 'next/link';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { JobAtRisk } from '@/lib/services/analytics';
import { formatIST } from '@/lib/utils/time';

/**
 * At-risk and delayed jobs, each naming the department holding it up
 * (build spec M8.3).
 *
 * Naming the department is the whole point of the table. "JGE-2026-0042 is
 * delayed" is a fact the MD already has; "Quality has had it for six days" is
 * the one that leads to a conversation.
 */
const STATUS_TONE: Record<string, string> = {
  AT_RISK: 'bg-state-problem/10 text-state-problem border-state-problem/30',
  DELAYED: 'bg-state-overdue/10 text-state-overdue border-state-overdue/30',
};

export function AtRiskTable({ jobs }: { jobs: JobAtRisk[] }) {
  return (
    <section className="rounded-lg border" aria-labelledby="at-risk">
      <header className="flex items-center justify-between border-b px-4 py-3">
        <h2 id="at-risk" className="text-sm font-semibold">
          Jobs at risk and delayed
        </h2>
        <Link href="/jobs" className="text-muted-foreground hover:text-foreground text-xs">
          All jobs
        </Link>
      </header>

      {jobs.length === 0 ? (
        <p className="text-muted-foreground px-4 py-10 text-center text-sm">
          Every live job is on track.
        </p>
      ) : (
        <>
          {/* Wide: a real table. */}
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-muted-foreground border-b text-left text-xs">
                  <th className="px-4 py-2 font-medium">Job</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 font-medium">Holding it up</th>
                  <th className="px-4 py-2 text-right font-medium">Overdue</th>
                  <th className="px-4 py-2 text-right font-medium">Problems</th>
                  <th className="px-4 py-2 font-medium">Deadline</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {jobs.map((job) => (
                  <tr key={job.id} className="hover:bg-accent/40 transition-colors">
                    <td className="px-4 py-2.5">
                      <Link href={`/jobs/${job.id}`} className="hover:underline">
                        <span className="tabular font-medium">{job.jobCode}</span>
                        <span className="text-muted-foreground ml-2">{job.title}</span>
                      </Link>
                    </td>
                    <td className="px-4 py-2.5">
                      <Badge variant="outline" className={cn('text-xs', STATUS_TONE[job.status])}>
                        {job.status === 'AT_RISK' ? 'At risk' : 'Delayed'}
                      </Badge>
                    </td>
                    <td className="px-4 py-2.5">
                      {job.blockingDepartment ? (
                        <>
                          <span className="font-medium">{job.blockingDepartment}</span>
                          <span className="text-muted-foreground ml-2 text-xs">
                            {job.blockingSubtaskTitle}
                          </span>
                        </>
                      ) : (
                        // At risk on the overall deadline with nothing yet
                        // individually late.
                        <span className="text-muted-foreground text-xs">Nothing overdue yet</span>
                      )}
                    </td>
                    <td className="tabular px-4 py-2.5 text-right">{job.overdueSubtasks || '—'}</td>
                    <td className="tabular px-4 py-2.5 text-right">{job.openProblems || '—'}</td>
                    <td className="text-muted-foreground tabular px-4 py-2.5 text-xs">
                      {formatIST(new Date(job.overallDeadline), 'd MMM yyyy')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Narrow: the same rows stacked, because a six-column table on a
              phone is a horizontal scroll nobody performs. */}
          <ul className="divide-y md:hidden">
            {jobs.map((job) => (
              <li key={job.id}>
                <Link href={`/jobs/${job.id}`} className="hover:bg-accent/40 block px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span className="tabular text-sm font-medium">{job.jobCode}</span>
                    <Badge
                      variant="outline"
                      className={cn('ml-auto text-xs', STATUS_TONE[job.status])}
                    >
                      {job.status === 'AT_RISK' ? 'At risk' : 'Delayed'}
                    </Badge>
                  </div>
                  <p className="mt-0.5 truncate text-sm">{job.title}</p>
                  <p className="text-muted-foreground mt-1 text-xs">
                    {job.blockingDepartment
                      ? `${job.blockingDepartment} · ${job.overdueSubtasks} overdue`
                      : 'Nothing overdue yet'}
                    {job.openProblems > 0 ? ` · ${job.openProblems} problems` : ''}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
