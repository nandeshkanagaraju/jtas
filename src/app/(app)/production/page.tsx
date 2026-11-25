import type { Metadata } from 'next';
import Link from 'next/link';
import { forbidden } from 'next/navigation';

import { PageHeader } from '@/components/shared/page-header';
import { Panel } from '@/components/shared/panel';
import { Badge } from '@/components/ui/badge';
import { ALL_ROLES_WITH_SUPERVISOR, requireActiveSession } from '@/lib/auth/session';
import {
  canSeeProduction,
  isProductionApprover,
  supervisorSections,
} from '@/lib/services/production/access';
import { currentShift, listReports, type ReportSummary } from '@/lib/services/production/reports';

import { reportHeading, STATUS_LABEL, STATUS_TONE } from './labels';
import { OpenShiftForm } from './open-shift-form';

export const metadata: Metadata = { title: 'Shift reports' };
export const dynamic = 'force-dynamic';

function ReportTable({ reports, empty }: { reports: ReportSummary[]; empty: string }) {
  if (reports.length === 0) {
    return <p className="text-muted-foreground p-5 text-sm">{empty}</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-muted-foreground text-left text-xs">
          <tr>
            <th className="px-5 py-2.5 font-medium">Shift</th>
            <th className="px-3 py-2.5 font-medium">Status</th>
            <th className="px-3 py-2.5 font-medium">Supervisor</th>
            <th className="px-3 py-2.5 text-right font-medium">Achieved</th>
            <th className="px-3 py-2.5 text-right font-medium">Efficiency</th>
            <th className="px-5 py-2.5 text-right font-medium">Warnings</th>
          </tr>
        </thead>
        <tbody>
          {reports.map((report) => (
            <tr key={report.id} className="border-border hover:bg-muted/30 border-t">
              <td className="px-5 py-2.5">
                <Link href={`/production/${report.id}`} className="font-medium hover:underline">
                  {reportHeading(report)}
                </Link>
              </td>
              <td className="px-3 py-2.5">
                <Badge variant={STATUS_TONE[report.status]}>{STATUS_LABEL[report.status]}</Badge>
              </td>
              <td className="px-3 py-2.5">{report.supervisor}</td>
              <td className="px-3 py-2.5 text-right font-mono tabular-nums">
                {report.achievedQty}
              </td>
              <td className="px-3 py-2.5 text-right font-mono tabular-nums">
                {report.efficiencyPct === null ? '—' : `${report.efficiencyPct}%`}
              </td>
              <td
                className={`px-5 py-2.5 text-right font-mono tabular-nums ${report.warningCount ? 'text-risk font-semibold' : ''}`}
              >
                {report.warningCount}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * The supervisor's starting point (open a shift, see their pages), and for
 * Planning and the MD the list of reports waiting and approved.
 */
export default async function ProductionPage() {
  const session = await requireActiveSession(ALL_ROLES_WITH_SUPERVISOR);
  if (!canSeeProduction(session)) forbidden();

  const sections = supervisorSections(session);
  const now = currentShift();
  const reports = await listReports(session);

  if (sections.length > 0) {
    const open = reports.filter((report) => report.status === 'DRAFT');
    const done = reports.filter((report) => report.status !== 'DRAFT');
    return (
      <div className="w-full space-y-5">
        <PageHeader
          eyebrow="Daily production report"
          title={`${sections.join(' & ')} shift entry`}
          lead="Open the shift, record every machine each hour, check the final report and submit it to Planning."
        />
        <Panel title="Open a shift">
          <div className="p-5">
            <OpenShiftForm sections={sections} defaultDate={now.date} defaultShift={now.shift} />
          </div>
        </Panel>
        <Panel title="Being filled" count={open.length} flush>
          <ReportTable reports={open} empty="No shift is open. Open the current shift above." />
        </Panel>
        <Panel title="Submitted" count={done.length} flush>
          <ReportTable reports={done} empty="Nothing submitted yet." />
        </Panel>
      </div>
    );
  }

  const waiting = reports.filter((report) => report.status === 'SUBMITTED');
  const approved = reports.filter((report) => report.status === 'APPROVED');
  const filling = reports.filter((report) => report.status === 'DRAFT');
  const approver = isProductionApprover(session);

  return (
    <div className="w-full space-y-5">
      <PageHeader
        eyebrow="Daily production report"
        title="Shift reports"
        lead={
          approver
            ? 'Reports the supervisors have submitted. Check the warnings, correct anything wrong, and approve — the MD is mailed.'
            : 'CNC and VMC shift reports. Approved reports are final; you are mailed each one.'
        }
      />
      <Panel title="Waiting for approval" count={waiting.length} flush>
        <ReportTable reports={waiting} empty="Nothing waiting." />
      </Panel>
      <Panel title="Approved" count={approved.length} flush>
        <ReportTable reports={approved} empty="No approved reports yet." />
      </Panel>
      {filling.length > 0 ? (
        <Panel title="Being filled on the floor" count={filling.length} flush>
          <ReportTable reports={filling} empty="" />
        </Panel>
      ) : null}
    </div>
  );
}
