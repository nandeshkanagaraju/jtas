import Link from 'next/link';

import type { JobAtRisk } from '@/lib/services/analytics';
import { formatIST } from '@/lib/utils/time';

/**
 * Jobs heading for trouble, each naming the department holding it up
 * (build spec M8.3).
 *
 * "JGE-2026-0042 is delayed" is a fact the MD already has from the lists
 * above. "Quality, final inspection" is the one that leads to a conversation.
 * A job can be at risk on its overall deadline with nothing individually
 * overdue yet, so there is not always a department to name.
 */

const ROW =
  'block border-b border-[#d5dbe3] py-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1c2430]';

export function AtRiskTable({ jobs, total }: { jobs: JobAtRisk[]; total: number }) {
  const hidden = Math.max(0, total - jobs.length);

  return (
    <section aria-labelledby="at-risk">
      <h2
        id="at-risk"
        className="flex items-baseline justify-between gap-4 border-b border-[#d5dbe3] pb-2 text-base font-semibold text-[#1c2430]"
      >
        <span>Jobs at risk</span>
        <span className="tabular">{jobs.length}</span>
      </h2>

      {jobs.length === 0 ? (
        <p className="border-b border-[#d5dbe3] py-3 text-base text-[#1c2430]">
          Every live job is on track.
        </p>
      ) : (
        <ul>
          {jobs.map((job) => (
            <li key={job.id}>
              <Link href={`/jobs/${job.id}`} className={ROW}>
                <div className="flex items-baseline justify-between gap-4">
                  <span className="tabular text-xl font-semibold text-[#1c2430]">
                    {job.jobCode}
                  </span>
                  <span
                    className={
                      job.status === 'DELAYED'
                        ? 'text-base font-semibold text-[#9f1239]'
                        : 'text-base font-semibold text-[#92400e]'
                    }
                  >
                    {job.status === 'DELAYED' ? 'Delayed' : 'At risk'}
                  </span>
                </div>
                <p className="mt-1 text-base font-semibold text-[#1c2430]">{job.title}</p>
                <p className="mt-1 text-base text-[#1c2430]">{holding(job)}</p>
                <p className="mt-1 text-sm text-[#1c2430]">
                  Due {formatIST(new Date(job.overallDeadline), 'd MMM')}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {hidden > 0 ? (
        <p className="border-b border-[#d5dbe3] py-3 text-base">
          <Link
            href="/jobs"
            className="text-[#1c2430] underline decoration-[#d5dbe3] underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1c2430]"
          >
            {hidden === 1 ? '1 more job' : `${hidden} more jobs`}
          </Link>
        </p>
      ) : null}
    </section>
  );
}

function holding(job: JobAtRisk): string {
  if (!job.blockingDepartment) return 'Nothing is overdue yet';

  const problems =
    job.openProblems === 0
      ? ''
      : job.openProblems === 1
        ? ', 1 open problem'
        : `, ${job.openProblems} open problems`;

  return `${job.blockingDepartment}, ${job.blockingSubtaskTitle}${problems}`;
}
