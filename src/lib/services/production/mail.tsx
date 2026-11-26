/**
 * The two production-report mails. Sent straight from the web app, like the
 * sign-in mails, so they do not depend on the scheduler function's build:
 *
 *   submitted → the approver (Planning), with the warnings to look at
 *   approved  → the MD (and Deputy), with the shift's totals
 *
 * A failed send is logged and never undoes the submission or approval; the
 * report is on the production page either way.
 */
import { plainTextSelectors, render } from '@react-email/render';

import { prisma } from '@/lib/db/prisma';
import { formatIST } from '@/lib/utils/time';
import { channelFor } from '@/lib/notifications/channels';
import {
  ActionButton,
  EmailLayout,
  FactTable,
  Heading,
  Paragraph,
} from '@/lib/notifications/templates/layout';
import { env } from '@/lib/utils/env';
import { moduleLogger } from '@/lib/utils/logger';

import { productionApproverEmails } from './access';
import type { ReportDto } from './reports';

const log = moduleLogger('production-mail');

const PLAIN_TEXT_OPTIONS = {
  selectors: [...plainTextSelectors, { selector: 'table', format: 'dataTable' }],
};

function base(): string {
  return env().APP_BASE_URL.replace(/\/+$/, '');
}

export function reportTitle(report: Pick<ReportDto, 'section' | 'shift' | 'date'>): string {
  const day = formatIST(new Date(`${report.date}T12:00:00+05:30`), 'dd MMM yyyy');
  return `${report.section} ${report.shift === 'DAY' ? 'Day' : 'Night'} shift, ${day}`;
}

function pct(value: number | null): string {
  return value === null ? '—' : `${value}%`;
}

function warningLines(report: ReportDto): string[] {
  return report.machines.flatMap((machine) =>
    machine.lines.flatMap((line) =>
      line.result.warnings
        .filter((warning) => warning.level === 'warning')
        .map((warning) => `${machine.code}: ${warning.message}`),
    ),
  );
}

function ReportMail({
  report,
  heading,
  intro,
  showWarnings,
}: {
  report: ReportDto;
  heading: string;
  intro: string;
  showWarnings: boolean;
}) {
  const warnings = warningLines(report);
  return (
    <EmailLayout preview={heading}>
      <Heading>{heading}</Heading>
      <Paragraph>{intro}</Paragraph>
      <FactTable
        rows={[
          ['Shift', reportTitle(report)],
          ['Supervisor', report.supervisor.name],
          ['Machines', String(report.machines.length)],
          ['Plan Qty', String(report.totals.planQty)],
          ['Actual Plan Qty', String(report.totals.actualPlanQty)],
          ['Achieved Qty', String(report.totals.achievedQty)],
          ['Efficiency (vs running hours)', pct(report.totals.efficiencyPct)],
          ['Efficiency (vs full shift)', pct(report.totals.utilisationPct)],
          ['Rework / Rejection', `${report.totals.reworkQty} / ${report.totals.rejectionQty}`],
          ['Warnings', String(report.warningCount)],
          ['Approved by', report.approvedBy?.name ?? null],
          ['Remarks', report.remarks],
        ]}
      />
      {showWarnings && warnings.length > 0 ? (
        <>
          <Paragraph>Figures that differ from the formula:</Paragraph>
          {warnings.slice(0, 15).map((line) => (
            <Paragraph key={line} muted>
              • {line}
            </Paragraph>
          ))}
          {warnings.length > 15 ? (
            <Paragraph muted>…and {warnings.length - 15} more on the report.</Paragraph>
          ) : null}
        </>
      ) : null}
      <ActionButton href={`${base()}/production/${report.id}`} label="Open the report" />
    </EmailLayout>
  );
}

async function renderMail(subject: string, element: React.ReactElement) {
  const [html, text] = await Promise.all([
    render(element, { pretty: false }),
    render(element, { plainText: true, htmlToTextOptions: PLAIN_TEXT_OPTIONS }),
  ]);
  return { subject, html, text };
}

async function sendTo(
  recipients: Array<{ id: string; name: string; email: string }>,
  kind: string,
  report: ReportDto,
  mail: { subject: string; html: string; text: string },
) {
  for (const recipient of recipients) {
    try {
      await channelFor('EMAIL').send(
        {
          id: `${kind}-${report.id}-${recipient.id}`,
          type: kind,
          subject: mail.subject,
          body: mail.text,
          html: mail.html,
          entityType: 'PRODUCTION_REPORT',
          entityId: report.id,
        },
        { id: recipient.id, name: recipient.name, email: recipient.email, phone: null },
      );
    } catch (error) {
      log.warn(
        {
          reportId: report.id,
          recipientId: recipient.id,
          err: error instanceof Error ? error.message : String(error),
        },
        `could not send the ${kind} mail`,
      );
    }
  }
}

export async function sendSubmittedMail(report: ReportDto): Promise<void> {
  const recipients = await prisma.user.findMany({
    where: { email: { in: productionApproverEmails() }, isActive: true, isDemo: false },
    select: { id: true, name: true, email: true },
  });
  const title = reportTitle(report);
  const mail = await renderMail(
    `[JTAS] Production report to approve: ${title}`,
    <ReportMail
      report={report}
      heading="A production report is waiting for you"
      intro={`${report.supervisor.name} submitted the ${title} report. Check it, correct anything that needs it, and approve it so it goes to the MD.`}
      showWarnings
    />,
  );
  await sendTo(recipients, 'PRODUCTION_REPORT_SUBMITTED', report, mail);
}

export async function sendApprovedMail(report: ReportDto): Promise<void> {
  const recipients = await prisma.user.findMany({
    where: { role: { in: ['MD', 'DEPUTY_MD'] }, isActive: true, isDemo: false },
    select: { id: true, name: true, email: true },
  });
  const title = reportTitle(report);
  const mail = await renderMail(
    `[JTAS] Production report approved: ${title}`,
    <ReportMail
      report={report}
      heading="Production report approved"
      intro={`${report.approvedBy?.name ?? 'The approver'} approved the ${title} report.`}
      showWarnings
    />,
  );
  await sendTo(recipients, 'PRODUCTION_REPORT_APPROVED', report, mail);
}
