import Link from 'next/link';
import { CalendarDays, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
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

export const metadata: Metadata = { title: 'Production overview' };
export const dynamic = 'force-dynamic';

/** Production pulse, the priority decision, then the full action register. */
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
      ? 'No completed tasks in the selected period.'
      : `${data.onTimeCompletionPercent}% of ${data.completedInRange} completed subtasks were on time` +
        (data.averageDelayHours > 0
          ? `, averaging ${formatElapsed(data.averageDelayHours * 60)} late.`
          : '.');

  return (
    <div className="space-y-8">
      <header className="overview-heading flex flex-wrap items-end justify-between gap-6">
        <div>
          <p className="eyebrow">Jaraa Global / Production control</p>
          <h1 className="overview-title mt-3">
            Production overview<span className="text-action">.</span>
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-muted-foreground mr-2 inline-flex items-center gap-2 text-xs">
            <CalendarDays className="size-4" />
            {formatIST(new Date(), 'dd MMM yyyy')}
          </span>
          {can(session, 'job:create', undefined) ? (
            <Button asChild>
              <Link href="/jobs/new">
                <Plus className="size-4" />
                New job
              </Link>
            </Button>
          ) : null}
        </div>
      </header>
      <SummaryStrip kpis={data.kpis} />

      <Triage
        problems={data.attention.problems}
        overdue={data.attention.overdueSubtasks}
        atRisk={data.jobsAtRisk}
        relays={relays}
      />

      <div className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="eyebrow">Performance review</p>
            <h2 className="section-title mt-1">Delivery, measured.</h2>
          </div>
          <Suspense fallback={<Skeleton className="h-14 w-72" />}>
            <RangePicker from={data.range.from} to={data.range.to} plain />
          </Suspense>
        </div>
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
