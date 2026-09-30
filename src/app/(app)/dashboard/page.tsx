import type { Metadata } from 'next';
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
import { mdDashboard, parseRange } from '@/lib/services/analytics';
import { formatDuration } from '@/lib/utils/duration';

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

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-muted-foreground mt-0.5 text-sm">
            {data.onTimeCompletionPercent === null
              ? 'Nothing has been completed in this range yet.'
              : `${data.onTimeCompletionPercent}% of ${data.completedInRange} completed subtasks were on time` +
                (data.averageDelayHours > 0
                  ? `, averaging ${formatDuration(data.averageDelayHours * 60)} late.`
                  : '.')}
          </p>
        </div>

        <Suspense fallback={<Skeleton className="h-7 w-64" />}>
          <RangePicker from={data.range.from} to={data.range.to} />
        </Suspense>
      </div>

      <KpiTiles kpis={data.kpis} />

      {/* Above the charts: these are the two lists that ask for a decision. */}
      <AttentionLists
        problems={data.attention.problems}
        overdueSubtasks={data.attention.overdueSubtasks}
      />

      <AtRiskTable jobs={data.jobsAtRisk} />

      <OnTimeTrend trend={data.trend} />
    </div>
  );
}
