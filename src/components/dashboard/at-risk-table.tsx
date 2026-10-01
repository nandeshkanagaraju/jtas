import Link from 'next/link';

import { Empty, Section } from '@/components/dashboard/section';
import { Badge } from '@/components/ui/badge';
import { jobStatusTone } from '@/lib/ui/tone';
import type { JobAtRisk } from '@/lib/services/analytics';
import { formatIST } from '@/lib/utils/time';

/**
 * Jobs heading for trouble, each naming the department holding it up
 * (build spec M8.3).
 *
 * "JGE-2026-0042 is delayed" is a fact the MD already has from the lists
 * above. "Quality, final inspection" is the one that leads to a conversation,
 * so it is the line that gets the weight. A job can be at risk on its overall
 * deadline with nothing individually overdue yet, so there is not always a
 * department to name.
 */
export function AtRiskTable({ jobs, total }: { jobs: JobAtRisk[]; total: number }) {
  const hidden = Math.max(0, total - jobs.length);

  return (
    <Section
      id="at-risk"
      title="Jobs at risk"
      count={total}
      countTone="risk"
      footer={
        hidden > 0
          ? { href: '/jobs', label: hidden === 1 ? '1 more job' : `${hidden} more jobs` }
          : undefined
      }
    >
      {jobs.length === 0 ? (
        <Empty>Every live job is on track.</Empty>
      ) : (
        <ul>
          {jobs.map((job) => (
            <li key={job.id} className="border-border border-t first:border-t-0">
              <Link
                href={`/jobs/${job.id}`}
                className="hover:bg-muted/60 block px-4 py-3 transition-colors"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="font-mono text-[13px] font-medium whitespace-nowrap">
                    {job.jobCode}
                  </span>
                  <Badge variant={jobStatusTone(job.status)} className="shrink-0">
                    {job.status === 'DELAYED' ? 'Delayed' : 'At risk'}
                  </Badge>
                </div>
                <p className="mt-1.5 truncate text-sm font-medium">{job.title}</p>
                <p className="text-foreground/80 mt-0.5 truncate text-sm">{holding(job)}</p>
                <p className="text-muted-foreground mt-1.5 text-xs tabular-nums">
                  Due {formatIST(new Date(job.overallDeadline), 'd MMM')}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Section>
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

  return `${job.blockingDepartment} — ${job.blockingSubtaskTitle}${problems}`;
}
