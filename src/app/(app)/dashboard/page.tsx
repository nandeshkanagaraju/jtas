import type { Metadata } from 'next';
import { forbidden } from 'next/navigation';
import { Suspense } from 'react';

import { OnTimeTrend } from '@/components/dashboard/on-time-trend';
import { RangePicker } from '@/components/dashboard/range-picker';
import { SummaryStrip } from '@/components/dashboard/summary-strip';
import { Triage } from '@/components/dashboard/triage';
import { relayStations, type RelayStation } from '@/components/shared/job-relay';
import { Skeleton } from '@/components/ui/skeleton';
import { can } from '@/lib/auth/policy';
import { requireActiveSession } from '@/lib/auth/session';
import { mdDashboard, parseRange } from '@/lib/services/analytics';
import { listJobSubtasks } from '@/lib/services/subtasks';
import { formatElapsed } from '@/lib/utils/duration';
import { formatIST } from '@/lib/utils/time';

export const metadata: Metadata = { title: 'Dashboard' };
export const dynamic = 'force-dynamic';

/**
 * MD dashboard.
 *
 * The first thing on the page is the decision. Counts and the completion
 * chart sit under it, because they review the shop rather than move it.
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

  const jobIds = [
    ...data.attention.problems.map((problem) => problem.jobId),
    ...data.attention.overdueSubtasks.map((subtask) => subtask.jobId),
    ...data.jobsAtRisk.map((job) => job.id),
  ];
  const relays = await loadRelays(session, jobIds);

  const onTime =
    data.onTimeCompletionPercent === null
      ? 'Nothing has been completed in this range yet.'
      : `${data.onTimeCompletionPercent}% of ${data.completedInRange} completed subtasks were on time` +
        (data.averageDelayHours > 0
          ? `, averaging ${formatElapsed(data.averageDelayHours * 60)} late.`
          : '.');

  return (
    <div className="space-y-8">
      <header>
        <p className="eyebrow">{formatIST(new Date(), 'EEEE d MMMM')}</p>
        <h1 className="page-title mt-1.5">What needs you</h1>
        <p className="page-lead mt-2">
          {headline(data.kpis.openProblems, data.kpis.overdueSubtasks)}
        </p>
      </header>

      <Triage
        problems={data.attention.problems}
        overdue={data.attention.overdueSubtasks}
        atRisk={data.jobsAtRisk}
        relays={relays}
      />

      <div className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <h2 className="section-title">The shop</h2>
          <Suspense fallback={<Skeleton className="h-14 w-72" />}>
            <RangePicker from={data.range.from} to={data.range.to} plain />
          </Suspense>
        </div>
        <SummaryStrip kpis={data.kpis} />
        <OnTimeTrend trend={data.trend} summary={onTime} />
      </div>
    </div>
  );
}

async function loadRelays(
  session: Awaited<ReturnType<typeof requireActiveSession>>,
  jobIds: string[],
): Promise<Record<string, RelayStation[]>> {
  const unique = [...new Set(jobIds)];
  const entries = await Promise.all(
    unique.map(async (id) => {
      try {
        const subtasks = await listJobSubtasks(session, id);
        return [id, relayStations(subtasks)] as const;
      } catch {
        return [id, [] as RelayStation[]] as const;
      }
    }),
  );
  return Object.fromEntries(entries);
}

function headline(problems: number, overdue: number): string {
  if (problems === 0 && overdue === 0) {
    return 'Every live job is on track and no one is blocked.';
  }

  const parts: string[] = [];
  if (problems > 0) parts.push(`${problems} open ${problems === 1 ? 'problem' : 'problems'}`);
  if (overdue > 0) parts.push(`${overdue} ${overdue === 1 ? 'deadline' : 'deadlines'} slipped`);

  return `${parts.join(' and ')}. The decision is the first item.`;
}
