'use client';

import { ArrowLeft, CheckCircle2, Send } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { approveReportRequest, submitReportRequest } from '@/lib/api/production-client';
import type { PartDto, ReportDto } from '@/lib/services/production/reports';
import { formatIST } from '@/lib/utils/time';

import { reportHeading, STATUS_LABEL, STATUS_TONE } from '../labels';
import { FinalTab } from './final-tab';
import { HourlyTab } from './hourly-tab';
import { IdleTab } from './idle-tab';
import { ReportProvider, useReport } from './report-context';
import { ReviewTab } from './review-tab';

export function ReportWorkspace({ initial, parts }: { initial: ReportDto; parts: PartDto[] }) {
  return (
    <ReportProvider initial={initial} initialParts={parts}>
      <Workspace />
    </ReportProvider>
  );
}

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="border-border bg-card rounded-xl border px-3 py-2.5">
      <p className="text-muted-foreground text-xs">{label}</p>
      <p className="mt-0.5 font-mono text-xl font-semibold tabular-nums">{value}</p>
      {hint ? <p className="text-muted-foreground text-[11px]">{hint}</p> : null}
    </div>
  );
}

function pct(value: number | null): string {
  return value === null ? '—' : `${value}%`;
}

function Workspace() {
  const { report, run, busy } = useReport();
  const [confirm, setConfirm] = useState<'submit' | 'approve' | null>(null);
  const [tab, setTab] = useState(report.status === 'DRAFT' && report.can.edit ? 'hourly' : 'final');

  const missing = report.machines.reduce((sum, machine) => sum + machine.missingSlots.length, 0);

  async function act() {
    const action = confirm;
    const ok = await run(
      () =>
        action === 'submit' ? submitReportRequest(report.id) : approveReportRequest(report.id),
      action === 'submit'
        ? 'Submitted. Planning has been mailed.'
        : 'Approved. The MD has been mailed.',
    );
    if (ok) setConfirm(null);
  }

  return (
    <div className="w-full space-y-5">
      <div className="space-y-3">
        <Link
          href="/production"
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
        >
          <ArrowLeft className="size-4" aria-hidden />
          Shift reports
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
              Daily production report
            </p>
            <h1 className="text-2xl font-semibold tracking-tight">{reportHeading(report)}</h1>
            <p className="text-muted-foreground mt-1 flex flex-wrap items-center gap-2 text-sm">
              <Badge variant={STATUS_TONE[report.status]}>{STATUS_LABEL[report.status]}</Badge>
              <span>Supervisor: {report.supervisor.name}</span>
              {report.approvedBy && report.approvedAt ? (
                <span>
                  · Approved by {report.approvedBy.name},{' '}
                  {formatIST(new Date(report.approvedAt), 'dd MMM, hh:mm a')}
                </span>
              ) : null}
            </p>
          </div>
          <div className="flex gap-2">
            {report.can.submit ? (
              <Button onClick={() => setConfirm('submit')} disabled={busy}>
                <Send className="size-4" aria-hidden />
                Submit report
              </Button>
            ) : null}
            {report.can.approve ? (
              <Button onClick={() => setConfirm('approve')} disabled={busy}>
                <CheckCircle2 className="size-4" aria-hidden />
                Approve
              </Button>
            ) : null}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Tile label="Plan Qty" value={String(report.totals.planQty)} />
        <Tile label="Actual Plan Qty" value={String(report.totals.actualPlanQty)} />
        <Tile label="Achieved" value={String(report.totals.achievedQty)} />
        <Tile
          label="Efficiency"
          value={pct(report.totals.efficiencyPct)}
          hint={`${pct(report.totals.utilisationPct)} of full shift`}
        />
        <Tile
          label="Rework / Rejection"
          value={`${report.totals.reworkQty} / ${report.totals.rejectionQty}`}
        />
        <Tile
          label="Warnings"
          value={String(report.warningCount)}
          hint={report.lateHours ? `${report.lateHours} late hour entries` : undefined}
        />
      </div>

      {report.status === 'SUBMITTED' && report.can.approve ? (
        <p className="border-risk-edge bg-risk-soft text-risk rounded-xl border px-4 py-3 text-sm">
          You can correct any figure before approving. Every change is recorded and shown to the MD.
        </p>
      ) : null}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="w-full justify-start overflow-x-auto sm:w-auto">
          <TabsTrigger value="hourly">Hourly</TabsTrigger>
          <TabsTrigger value="final">Final</TabsTrigger>
          <TabsTrigger value="idle">Idle</TabsTrigger>
          <TabsTrigger value="review">
            Remarks
            {report.warningCount > 0 ? (
              <span className="bg-risk text-risk-soft ml-1 rounded-full px-1.5 text-[11px]">
                {report.warningCount}
              </span>
            ) : null}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="hourly" className="pt-4">
          <HourlyTab />
        </TabsContent>
        <TabsContent value="final" className="pt-4">
          <FinalTab />
        </TabsContent>
        <TabsContent value="idle" className="pt-4">
          <IdleTab />
        </TabsContent>
        <TabsContent value="review" className="pt-4">
          <ReviewTab />
        </TabsContent>
      </Tabs>

      <Dialog open={confirm !== null} onOpenChange={(open) => !open && setConfirm(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {confirm === 'submit' ? 'Submit this report?' : 'Approve this report?'}
            </DialogTitle>
            <DialogDescription>
              {confirm === 'submit'
                ? 'It goes to Planning for approval and you can no longer change it.'
                : 'It is final once approved, and the MD is mailed.'}
            </DialogDescription>
          </DialogHeader>
          <ul className="text-sm">
            <li>
              {report.machines.length} machines · achieved {report.totals.achievedQty} ·{' '}
              {pct(report.totals.efficiencyPct)}
            </li>
            {report.warningCount > 0 ? (
              <li className="text-risk">
                {report.warningCount} figure{report.warningCount === 1 ? '' : 's'} differ from the
                formula and will be shown{confirm === 'submit' ? ' to Planning' : ' to the MD'}.
              </li>
            ) : null}
            {confirm === 'submit' && missing > 0 ? (
              <li className="text-late">
                {missing} hour{missing === 1 ? ' is' : 's are'} not recorded yet. Every hour must be
                recorded before submitting.
              </li>
            ) : null}
          </ul>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirm(null)}>
              Not yet
            </Button>
            <Button onClick={act} disabled={busy}>
              {confirm === 'submit' ? 'Submit' : 'Approve'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
