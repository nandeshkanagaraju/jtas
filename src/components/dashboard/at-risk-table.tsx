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
  'mt-3 block rounded-xl border border-[#313743] bg-[#262b36] px-4 py-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d6f25a]';

export function AtRiskTable({ jobs, total }: { jobs: JobAtRisk[]; total: number }) {
  const hidden = Math.max(0, total - jobs.length);

  return (
    <section aria-labelledby="at-risk">
      <h2
        id="at-risk"
        className="flex items-baseline justify-between gap-4 border-b border-[#313743] py-3 text-sm font-semibold text-[#f3f5f8]"
      >
        <span>Jobs at risk</span>
        <span className="font-mono text-sm font-medium text-[#aeb6c3]">{jobs.length}</span>
      </h2>

      {jobs.length === 0 ? (
        <p className="border-b border-[#313743] py-4 text-sm leading-6 text-[#aeb6c3]">
          Every live job is on track.
        </p>
      ) : (
        <ul>
          {jobs.map((job) => (
            <li key={job.id}>
              <Link href={`/jobs/${job.id}`} className={ROW}>
                <div className="flex items-baseline justify-between gap-4">
                  <span className="font-mono text-sm font-medium text-[#f3f5f8]">
                    {job.jobCode}
                  </span>
                  <span
                    className={
                      job.status === 'DELAYED'
                        ? 'rounded-full bg-[#fb7185]/15 px-2 py-0.5 text-xs font-semibold text-[#fb7185]'
                        : 'rounded-full bg-[#fbbf24]/15 px-2 py-0.5 text-xs font-semibold text-[#fbbf24]'
                    }
                  >
                    {job.status === 'DELAYED' ? 'Delayed' : 'At risk'}
                  </span>
                </div>
                <p className="mt-2 text-sm leading-6 font-semibold text-[#f3f5f8]">{job.title}</p>
                <p className="mt-1 text-sm leading-6 text-[#f3f5f8]">{holding(job)}</p>
                <p className="mt-1 text-sm leading-6 text-[#aeb6c3]">
                  Due {formatIST(new Date(job.overallDeadline), 'd MMM')}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {hidden > 0 ? (
        <p className="border-b border-[#313743] py-4 text-sm leading-6">
          <Link
            href="/jobs"
            className="text-[#f3f5f8] underline decoration-[#313743] underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f3f5f8]"
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
