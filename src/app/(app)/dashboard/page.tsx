import type { Metadata } from 'next';
import Link from 'next/link';
import { forbidden } from 'next/navigation';
import { Suspense } from 'react';

import { AtRiskTable } from '@/components/dashboard/at-risk-table';
import { AttentionLists } from '@/components/dashboard/attention-lists';
import { KpiTiles } from '@/components/dashboard/kpi-tiles';
import { OnTimeTrend } from '@/components/dashboard/on-time-trend';
import { RangePicker } from '@/components/dashboard/range-picker';
import { Skeleton } from '@/components/ui/skeleton';
import { can } from '@/lib/auth/policy';
import { requireActiveSession } from '@/lib/auth/session';
import {
  mdDashboard,
  parseRange,
  type AttentionProblem,
  type AttentionSubtask,
} from '@/lib/services/analytics';
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

  const onTime =
    data.onTimeCompletionPercent === null
      ? 'Nothing has been completed in this range yet.'
      : `${data.onTimeCompletionPercent}% of ${data.completedInRange} completed subtasks were on time` +
        (data.averageDelayHours > 0
          ? `, averaging ${formatElapsed(data.averageDelayHours * 60)} late.`
          : '.');

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3">
        <div className="min-w-0">
          <p className="font-mono text-[11px] tracking-[0.16em] text-[#aeb6c3] uppercase">
            {formatIST(new Date(), 'EEE d MMM')}
          </p>
          <h1 className="mt-1 text-xl font-semibold tracking-[-0.02em] text-[#f3f5f8]">
            <Count n={data.kpis.openProblems} urgent={data.kpis.openProblems > 0} />{' '}
            {data.kpis.openProblems === 1 ? 'problem' : 'problems'}
            <span className="font-normal text-[#aeb6c3]">, </span>
            <Count n={data.kpis.overdueSubtasks} urgent={data.kpis.overdueSubtasks > 0} />{' '}
            {data.kpis.overdueSubtasks === 1 ? 'deadline slipped' : 'deadlines slipped'}
          </h1>
          <StartHere
            problem={data.attention.problems[0]}
            late={data.attention.overdueSubtasks[0]}
          />
        </div>
      </header>
      <AttentionLists
        problems={data.attention.problems}
        overdueSubtasks={data.attention.overdueSubtasks}
        openProblems={data.kpis.openProblems}
        overdueTotal={data.kpis.overdueSubtasks}
      />

      <div className="space-y-8 rounded-lg border border-[#313743] bg-[#1e222b] px-5 pt-2 pb-6">
        <div className="space-y-4 pt-4">
          <KpiTiles kpis={data.kpis} />
          <p className="text-sm leading-6 text-[#aeb6c3]">{onTime}</p>
          <div>
            <Suspense fallback={<Skeleton className="h-11 w-64" />}>
              <RangePicker from={data.range.from} to={data.range.to} plain />
            </Suspense>
          </div>
        </div>
        <AtRiskTable jobs={data.jobsAtRisk} total={data.kpis.atRiskJobs + data.kpis.delayedJobs} />
        <OnTimeTrend trend={data.trend} />
      </div>
    </div>
  );
}

function Count({ n, urgent }: { n: number; urgent: boolean }) {
  return <span className={urgent ? 'font-mono text-[#fb7185]' : 'font-mono'}>{n}</span>;
}

function StartHere({
  problem,
  late,
}: {
  problem: AttentionProblem | undefined;
  late: AttentionSubtask | undefined;
}) {
  if (problem) {
    return (
      <p className="mt-2 max-w-2xl text-sm leading-6 text-[#aeb6c3]">
        Start with{' '}
        <Link href={`/problems?open=${problem.id}`} className={START}>
          {problem.jobCode}
        </Link>
        , {problem.departmentName}, {problem.assigneeName}. {problem.description}
      </p>
    );
  }
  if (late) {
    return (
      <p className="mt-2 max-w-2xl text-sm leading-6 text-[#aeb6c3]">
        Furthest behind is{' '}
        <Link href={`/tasks/${late.id}`} className={START}>
          {late.jobCode}
        </Link>
        , {late.departmentName}, {late.assigneeName}, {formatElapsed(late.overdueHours * 60)} late.
      </p>
    );
  }
  return <p className="mt-2 text-sm leading-6 text-[#aeb6c3]">Nothing is waiting on you.</p>;
}

const START =
  'font-mono text-[#f3f5f8] underline decoration-[#313743] underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d6f25a]';
