import type { Metadata } from 'next';
import { forbidden } from 'next/navigation';
import { Suspense } from 'react';

import { AtRiskTable } from '@/components/dashboard/at-risk-table';
import { ProblemList, SlippedDeadlines } from '@/components/dashboard/attention-lists';
import { OnTimeTrend } from '@/components/dashboard/on-time-trend';
import { PriorityCallout } from '@/components/dashboard/priority-callout';
import { RangePicker } from '@/components/dashboard/range-picker';
import { SummaryStrip } from '@/components/dashboard/summary-strip';
import { Skeleton } from '@/components/ui/skeleton';
import { can } from '@/lib/auth/policy';
import { requireActiveSession } from '@/lib/auth/session';
import { mdDashboard, parseRange } from '@/lib/services/analytics';
import { formatElapsed } from '@/lib/utils/duration';
import { formatIST } from '@/lib/utils/time';

export const metadata: Metadata = { title: 'Dashboard' };
export const dynamic = 'force-dynamic';

/**
 * MD dashboard (FR-60, build spec M8.3).
 *
 * Access is decided here, server-side, through the same `can()` the API uses —
 * middleware lets a member reach this URL precisely so that the refusal is a
 * real 403 rather than a redirect that hides it.
 *
 * The whole payload is fetched in one service call on the server, so the page
 * arrives rendered rather than as six spinners that resolve one at a time.
 *
 * The page answers three questions, top to bottom, and nothing else:
 *   1. how is the shop, right now        -> the summary strip
 *   2. what do I do first                -> the priority callout
 *   3. what is behind it                 -> slipped deadlines, problems, jobs
 * The completion chart is last because it is a review, not a decision.
 */
export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const session = await requireActiveSession();
  if (!can(session, 'dashboard:md', undefined)) forbidden();

  const params = await searchParams;
  const range = parseRange({ from: params.from, to: params.to });
  const data = await mdDashboard(range);

  // The wording of this sentence is load-bearing: the e2e spec reads it back
  // to prove the screen agrees with lib/domain/metrics' definition of on time.
  const onTime =
    data.onTimeCompletionPercent === null
      ? 'Nothing has been completed in this range yet.'
      : `${data.onTimeCompletionPercent}% of ${data.completedInRange} completed subtasks were on time` +
        (data.averageDelayHours > 0
          ? `, averaging ${formatElapsed(data.averageDelayHours * 60)} late.`
          : '.');

  const { openProblems, overdueSubtasks } = data.kpis;

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-x-8 gap-y-4">
        <div className="min-w-0">
          <p className="eyebrow">{formatIST(new Date(), 'EEEE d MMMM')}</p>
          <h1 className="font-display mt-1.5 text-2xl font-semibold tracking-[-0.02em]">
            Dashboard
          </h1>
          <p className="text-muted-foreground mt-1 max-w-prose text-sm">
            {headline(openProblems, overdueSubtasks)}
          </p>
        </div>
        <Suspense fallback={<Skeleton className="h-14 w-72" />}>
          <RangePicker from={data.range.from} to={data.range.to} plain />
        </Suspense>
      </header>

      <SummaryStrip kpis={data.kpis} />

      <PriorityCallout
        problem={data.attention.problems[0]}
        late={data.attention.overdueSubtasks[0]}
      />

      {/*
        Slipped deadlines takes the wide column because it is the only block
        that rewards comparing rows against each other. The two per-job queues
        ride beside it and stack under it below `xl`. The completion chart sits
        under the table rather than across the full width, so the wide column
        keeps pace with the tall one instead of leaving a hole beside it.
      */}
      {/*
        Two independent columns at `xl`, so neither leaves a hole when the
        other runs longer. Below `xl` the left column is `display: contents`,
        which promotes its panels into the outer flex row; the chart is ordered
        last there so a phone reads the three decision queues before the review.
      */}
      <div className="flex flex-col gap-5 xl:grid xl:grid-cols-3 xl:items-start">
        <div className="contents xl:col-span-2 xl:flex xl:min-w-0 xl:flex-col xl:gap-5">
          <SlippedDeadlines subtasks={data.attention.overdueSubtasks} total={overdueSubtasks} />
          <div className="order-last xl:order-none">
            <OnTimeTrend trend={data.trend} summary={onTime} />
          </div>
        </div>

        <div className="flex min-w-0 flex-col gap-5">
          <ProblemList problems={data.attention.problems} total={openProblems} />
          <AtRiskTable
            jobs={data.jobsAtRisk}
            total={data.kpis.atRiskJobs + data.kpis.delayedJobs}
          />
        </div>
      </div>
    </div>
  );
}

/** One sentence under the title: the state of the shop, in words. */
function headline(problems: number, overdue: number): string {
  if (problems === 0 && overdue === 0) {
    return 'Every live job is on track and no one is blocked.';
  }

  const parts: string[] = [];
  if (problems > 0) parts.push(`${problems} open ${problems === 1 ? 'problem' : 'problems'}`);
  if (overdue > 0) parts.push(`${overdue} ${overdue === 1 ? 'deadline' : 'deadlines'} slipped`);

  return `${parts.join(' and ')} — start with the item below.`;
}
