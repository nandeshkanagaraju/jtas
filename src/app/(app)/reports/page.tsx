import type { Metadata } from 'next';
import { forbidden } from 'next/navigation';

import { RangePicker } from '@/components/dashboard/range-picker';
import { PageHeader } from '@/components/shared/page-header';
import { Panel } from '@/components/shared/panel';
import { EmptyState } from '@/components/shared/states';
import { TabNav } from '@/components/shared/tab-nav';
import { ListExports, JobReportExports } from '@/components/reports/export-menu';
import { JobReportView } from '@/components/reports/job-report-view';
import { ScorecardChart } from '@/components/reports/scorecard-chart';
import { ScorecardTable } from '@/components/reports/scorecard-table';
import { can } from '@/lib/auth/policy';
import { requireActiveSession } from '@/lib/auth/session';
import { departmentScorecards, parseRange } from '@/lib/services/analytics';
import { jobReport } from '@/lib/services/reports';
import { prisma } from '@/lib/db/prisma';

import { FileText } from 'lucide-react';

import { JobPicker, type PickableJob } from './job-picker';

export const metadata: Metadata = { title: 'Reports' };
export const dynamic = 'force-dynamic';

/** How many jobs the picker holds before it asks the reader to search. */
const JOB_PICKER_LIMIT = 400;

type Tab = 'scorecards' | 'jobs';

/**
 * Reports (build spec M8.4).
 *
 * Two views behind one URL: the department scorecard, and a single job's full
 * record. Both are server-rendered from the range in the query string, so a
 * report can be linked to and will show the same numbers to whoever opens it.
 */
export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; tab?: string; job?: string }>;
}) {
  const session = await requireActiveSession();
  // Export permission is the wider grant (it includes ADMIN); reading the
  // scorecards is the command-level one, and it is what gates this page.
  if (!can(session, 'dashboard:department', undefined)) forbidden();

  const params = await searchParams;
  const range = parseRange({ from: params.from, to: params.to });
  const tab: Tab = params.tab === 'jobs' ? 'jobs' : 'scorecards';

  const exportParams = { from: range.fromKey, to: range.toKey };

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="The record"
        title="Reports"
        lead="How each department is holding its dates, and the full history of any one job."
        actions={<RangePicker from={range.fromKey} to={range.toKey} />}
      >
        <TabNav
          label="Report views"
          current={tab}
          tabs={[
            {
              id: 'scorecards',
              label: 'Department scorecards',
              href: `/reports?tab=scorecards&from=${range.fromKey}&to=${range.toKey}`,
            },
            {
              id: 'jobs',
              label: 'Job report',
              href: `/reports?tab=jobs&from=${range.fromKey}&to=${range.toKey}`,
            },
          ]}
        />
      </PageHeader>

      {tab === 'scorecards' ? (
        <Scorecards range={range} exportParams={exportParams} />
      ) : (
        <JobReports exportParams={exportParams} selected={params.job ?? null} />
      )}
    </div>
  );
}

async function Scorecards({
  range,
  exportParams,
}: {
  range: Awaited<ReturnType<typeof parseRange>>;
  exportParams: { from: string; to: string };
}) {
  const rows = await departmentScorecards(range);

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <ListExports params={exportParams} />
      </div>

      <ScorecardTable rows={rows} />
      <ScorecardChart rows={rows} />
    </div>
  );
}

/**
 * The job report view.
 *
 * Deliberately not range-bound: somebody asking why a job was late is asking
 * about that job, and hiding it because it started outside the selected month
 * would be a filter nobody asked for. The range still rides along to the export
 * links, which use it for the filename.
 */
async function JobReports({
  exportParams,
  selected,
}: {
  exportParams: { from: string; to: string };
  selected: string | null;
}) {
  const jobs: PickableJob[] = await prisma.job.findMany({
    where: { status: { not: 'DRAFT' } },
    take: JOB_PICKER_LIMIT,
    orderBy: { createdAt: 'desc' },
    select: { id: true, jobCode: true, title: true, status: true, customerName: true },
  });

  // A report of nothing is a worse landing than the newest job's report.
  const jobId = selected ?? jobs[0]?.id ?? null;
  const report = jobId ? await jobReport(jobId).catch(() => null) : null;

  return (
    <div className="grid gap-4 lg:grid-cols-[18rem_1fr]">
      <JobPicker jobs={jobs} selected={jobId} />

      {report ? (
        <div className="space-y-3">
          <div className="flex justify-end">
            <JobReportExports params={{ ...exportParams, jobId: report.job.id }} />
          </div>
          <JobReportView report={report} />
        </div>
      ) : (
        <Panel flush>
          <EmptyState
            icon={FileText}
            title={jobs.length === 0 ? 'No jobs published yet' : 'Choose a job'}
            description={
              jobs.length === 0
                ? 'A job appears here once it has been published — a draft has no record to report on.'
                : 'Pick one from the list to see its full record: every department, every date, every problem.'
            }
          />
        </Panel>
      )}
    </div>
  );
}
