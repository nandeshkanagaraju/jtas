'use client';

import { RotateCcw } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Input } from '@/components/ui/input';
import { updateLineRequest } from '@/lib/api/production-client';
import {
  IDLE_REASON_LABELS,
  IDLE_REASONS,
  type IdleMinutes,
  type IdleReason,
} from '@/lib/domain/production';
import type { LineDto } from '@/lib/services/production/reports';
import { cn } from '@/lib/utils';

import { useReport } from './report-context';

/** Minutes shown as the book writes them: hours, quarters as decimals. */
function hoursText(minutes: number | undefined): string {
  if (!minutes) return '';
  return String(Math.round((minutes / 60) * 100) / 100);
}

function sameIdle(a: IdleMinutes, b: IdleMinutes): boolean {
  return IDLE_REASONS.every((reason) => (a[reason] ?? 0) === (b[reason] ?? 0));
}

function IdleCell({
  line,
  reason,
  disabled,
  onCommit,
}: {
  line: LineDto;
  reason: IdleReason;
  disabled: boolean;
  onCommit: (minutes: number) => void;
}) {
  const value = line.result.idle.value[reason];
  const computed = line.result.idle.computed[reason] ?? 0;
  const differs = line.result.idle.overridden && (value ?? 0) !== computed;
  const [text, setText] = useState(hoursText(value));
  useEffect(() => setText(hoursText(value)), [value]);

  if (disabled) {
    return (
      <span className={cn('font-mono tabular-nums', differs && 'text-risk font-semibold')}>
        {hoursText(value) || ''}
      </span>
    );
  }
  return (
    <Input
      aria-label={`${line.machineCode} ${IDLE_REASON_LABELS[reason]} hours`}
      inputMode="decimal"
      value={text}
      title={differs ? `Hourly entries give ${hoursText(computed) || 0} h` : undefined}
      onChange={(event) => setText(event.target.value)}
      onBlur={() => {
        const hours = text.trim() === '' ? 0 : Number(text);
        if (!Number.isFinite(hours) || hours < 0) return setText(hoursText(value));
        const minutes = Math.round(hours * 60);
        if (minutes !== (value ?? 0)) onCommit(minutes);
      }}
      className={cn(
        'h-8 w-16 px-1.5 text-right font-mono tabular-nums',
        differs && 'border-risk-edge bg-risk-soft text-risk font-semibold',
      )}
    />
  );
}

export function IdleTab() {
  const { report, run } = useReport();
  const disabled = !report.can.edit;
  const lines = report.machines.flatMap((machine) => machine.lines);

  function commit(line: LineDto, reason: IdleReason, minutes: number) {
    const next: IdleMinutes = { ...line.result.idle.value, [reason]: minutes };
    if (minutes === 0) delete next[reason];
    const idleEntered = sameIdle(next, line.result.idle.computed) ? null : next;
    void run(() => updateLineRequest(report.id, line.id, { idleEntered }));
  }

  return (
    <div className="space-y-3">
      <p className="text-muted-foreground max-w-3xl text-sm">
        Reason for machine idle, in hours (0.25 = 15 minutes). Added up from the hourly entries; a
        changed figure is marked and shown to the approver.
      </p>
      <div className="border-border bg-card overflow-x-auto rounded-xl border">
        <table className="w-full min-w-[1200px] text-sm">
          <thead className="bg-muted/50 text-muted-foreground text-left text-xs">
            <tr>
              <th className="px-3 py-2 font-medium">Machine</th>
              {IDLE_REASONS.map((reason) => (
                <th key={reason} className="px-1.5 py-2 text-right font-medium">
                  {IDLE_REASON_LABELS[reason]}
                </th>
              ))}
              <th className="px-2 py-2 text-right font-medium">Total</th>
              <th className="px-3 py-2 font-medium">Remarks, if any</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => (
              <tr key={line.id} className="border-border border-t align-top">
                <td className="px-3 py-2">
                  <span className="font-mono font-semibold">{line.machineCode}</span>
                  {line.result.idle.overridden && !disabled ? (
                    <button
                      type="button"
                      className="text-muted-foreground hover:text-foreground mt-1 flex items-center gap-1 text-[11px]"
                      onClick={() =>
                        void run(() => updateLineRequest(report.id, line.id, { idleEntered: null }))
                      }
                    >
                      <RotateCcw className="size-3" aria-hidden />
                      from hours
                    </button>
                  ) : null}
                </td>
                {IDLE_REASONS.map((reason) => (
                  <td key={reason} className="px-1.5 py-2 text-right">
                    <IdleCell
                      line={line}
                      reason={reason}
                      disabled={disabled}
                      onCommit={(minutes) => commit(line, reason, minutes)}
                    />
                  </td>
                ))}
                <td className="px-2 py-2 pt-3.5 text-right font-mono font-semibold tabular-nums">
                  {line.result.idleHours}
                </td>
                <td className="px-3 py-2">
                  <RemarkCell line={line} disabled={disabled} />
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot className="border-border bg-muted/30 border-t font-medium">
            <tr>
              <td className="px-3 py-2">Total</td>
              {IDLE_REASONS.map((reason) => (
                <td key={reason} className="px-1.5 py-2 text-right font-mono tabular-nums">
                  {hoursText(report.totals.idle[reason])}
                </td>
              ))}
              <td />
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

function RemarkCell({ line, disabled }: { line: LineDto; disabled: boolean }) {
  const { report, run } = useReport();
  const [text, setText] = useState(line.remarks ?? '');
  useEffect(() => setText(line.remarks ?? ''), [line.remarks]);
  if (disabled) return <span>{line.remarks ?? ''}</span>;
  return (
    <Input
      aria-label={`${line.machineCode} remarks`}
      value={text}
      placeholder="e.g. Air low"
      onChange={(event) => setText(event.target.value)}
      onBlur={() => {
        const next = text.trim() || null;
        if (next !== line.remarks) {
          void run(() => updateLineRequest(report.id, line.id, { remarks: next }));
        }
      }}
      className="h-8 min-w-48 px-2"
    />
  );
}
