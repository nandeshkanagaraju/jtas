'use client';

import { AlertTriangle, Info, RotateCcw } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Input } from '@/components/ui/input';
import { updateLineRequest } from '@/lib/api/production-client';
import type { Figure, ProductionWarning } from '@/lib/domain/production';
import type { LineDto } from '@/lib/services/production/reports';
import type { UpdateLineInput } from '@/lib/validation/production';
import { cn } from '@/lib/utils';

import { useReport } from './report-context';

/**
 * A number on the final report. Shows the worked-out figure; typing a
 * different one keeps it, marked, with the formula's figure underneath.
 * Typing the formula's figure back (or "reset") drops the override.
 */
export function FigureCell({
  figure,
  label,
  disabled,
  decimals,
  onCommit,
}: {
  figure: Figure<number | null>;
  label: string;
  disabled: boolean;
  decimals?: boolean;
  onCommit: (value: number | null) => void;
}) {
  const [text, setText] = useState(figure.value === null ? '' : String(figure.value));
  useEffect(() => setText(figure.value === null ? '' : String(figure.value)), [figure.value]);

  const differs = figure.overridden && figure.value !== figure.computed;

  function commit() {
    const trimmed = text.trim();
    if (trimmed === '') {
      if (figure.overridden) onCommit(null);
      return;
    }
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed) || parsed < 0) {
      setText(figure.value === null ? '' : String(figure.value));
      return;
    }
    const value = decimals ? Math.round(parsed * 100) / 100 : Math.round(parsed);
    if (value === figure.value) return;
    onCommit(value === figure.computed ? null : value);
  }

  if (disabled) {
    return (
      <div className="text-right">
        <span className={cn('font-mono tabular-nums', differs && 'text-risk font-semibold')}>
          {figure.value ?? '—'}
        </span>
        {differs ? (
          <div className="text-muted-foreground text-[11px]">formula {figure.computed ?? '—'}</div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="min-w-[4.5rem]">
      <Input
        aria-label={label}
        inputMode={decimals ? 'decimal' : 'numeric'}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') (event.target as HTMLInputElement).blur();
        }}
        className={cn(
          'h-8 px-2 text-right font-mono tabular-nums',
          differs && 'border-risk-edge bg-risk-soft text-risk font-semibold',
        )}
      />
      {differs ? (
        <button
          type="button"
          className="text-muted-foreground hover:text-foreground mt-0.5 flex items-center gap-1 text-[11px]"
          onClick={() => onCommit(null)}
          title="Use the formula's figure"
        >
          <RotateCcw className="size-3" aria-hidden />
          formula {figure.computed ?? '—'}
        </button>
      ) : null}
    </div>
  );
}

export function WarningList({ warnings }: { warnings: ProductionWarning[] }) {
  if (warnings.length === 0) return null;
  return (
    <ul className="space-y-1">
      {warnings.map((warning, index) => (
        <li
          key={`${warning.code}-${index}`}
          className={cn(
            'flex items-start gap-1.5 text-xs',
            warning.level === 'warning' ? 'text-risk' : 'text-muted-foreground',
          )}
        >
          {warning.level === 'warning' ? (
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          ) : (
            <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          )}
          <span>{warning.message}</span>
        </li>
      ))}
    </ul>
  );
}

function TextCell({
  value,
  label,
  disabled,
  onCommit,
  className,
  placeholder,
}: {
  value: string | null;
  label: string;
  disabled: boolean;
  onCommit: (value: string | null) => void;
  className?: string;
  placeholder?: string;
}) {
  const [text, setText] = useState(value ?? '');
  useEffect(() => setText(value ?? ''), [value]);
  if (disabled) return <span className={className}>{value ?? '—'}</span>;
  return (
    <Input
      aria-label={label}
      placeholder={placeholder}
      value={text}
      onChange={(event) => setText(event.target.value)}
      onBlur={() => {
        const next = text.trim() || null;
        if (next !== value) onCommit(next);
      }}
      className={cn('h-8 px-2', className)}
    />
  );
}

function pct(value: number | null): string {
  return value === null ? '—' : `${value}%`;
}

export function FinalTab() {
  const { report, run } = useReport();
  const disabled = !report.can.edit;

  function save(line: LineDto, input: UpdateLineInput) {
    void run(() => updateLineRequest(report.id, line.id, input));
  }

  const lines = report.machines.flatMap((machine) => machine.lines);

  return (
    <div className="space-y-3">
      <p className="text-muted-foreground max-w-3xl text-sm">
        Worked out from the hourly entries. Correct any figure that is wrong: a figure that differs
        from the formula is kept, marked, and shown to the approver with what the formula gives.
      </p>

      <div className="border-border bg-card overflow-x-auto rounded-xl border">
        <table className="w-full min-w-[1100px] text-sm">
          <thead className="bg-muted/50 text-muted-foreground text-left text-xs">
            <tr>
              <th className="px-3 py-2 font-medium">Machine</th>
              <th className="px-2 py-2 font-medium">Operator</th>
              <th className="px-2 py-2 font-medium">Part · Op</th>
              <th className="px-2 py-2 text-right font-medium">Cycle → Pcs/hr</th>
              <th className="px-2 py-2 text-right font-medium">Hrs run</th>
              <th className="px-2 py-2 text-right font-medium">Plan Qty</th>
              <th className="px-2 py-2 text-right font-medium">Actual Plan</th>
              <th className="px-2 py-2 text-right font-medium">Achieved</th>
              <th className="px-2 py-2 text-right font-medium">%</th>
              <th className="px-2 py-2 text-right font-medium">Rework</th>
              <th className="px-2 py-2 text-right font-medium">Rejection</th>
              <th className="px-3 py-2 font-medium">Reason for NC part</th>
            </tr>
          </thead>
          {lines.map((line) => {
            const r = line.result;
            const warnings = r.warnings.filter((w) => w.level === 'warning');
            if (!line.recorded) {
              return (
                <tbody key={line.id} className="border-border text-muted-foreground border-t">
                  <tr className="align-top">
                    <td className="px-3 py-2 font-mono font-semibold">{line.machineCode}</td>
                    <td className="px-2 py-2">{line.operatorName ?? '—'}</td>
                    <td className="px-2 py-2">{line.partLabel ?? '—'}</td>
                    <td colSpan={6} className="px-2 py-2 text-xs italic">
                      Not running — nothing recorded this shift
                    </td>
                    <td colSpan={3} className="px-3 py-2">
                      <TextCell
                        value={line.remarks}
                        label={`${line.machineCode} reason not running`}
                        placeholder="Reason not running"
                        disabled={disabled}
                        onCommit={(v) => save(line, { remarks: v })}
                      />
                    </td>
                  </tr>
                </tbody>
              );
            }
            return (
              <tbody key={line.id} className="border-border border-t">
                <tr className="align-top">
                  <td className="px-3 py-2 font-mono font-semibold">{line.machineCode}</td>
                  <td className="px-2 py-2">{line.operatorName ?? '—'}</td>
                  <td className="px-2 py-2">
                    {line.partLabel ?? <span className="text-muted-foreground">Idle</span>}
                    {line.operation ? (
                      <span className="text-muted-foreground"> · {line.operationLabel}</span>
                    ) : null}
                  </td>
                  <td className="px-2 py-2">
                    <div className="flex items-start justify-end gap-1.5">
                      <span className="text-muted-foreground pt-1.5 font-mono text-xs whitespace-nowrap">
                        {r.cycleTotalSec !== null
                          ? `${line.cycleSec ?? 0}${line.loadSec ? `+${line.loadSec}` : ''}=`
                          : ''}
                      </span>
                      <FigureCell
                        figure={r.pcsPerHour}
                        label={`${line.machineCode} pieces per hour`}
                        disabled={disabled}
                        onCommit={(v) => save(line, { pcsPerHourEntered: v })}
                      />
                    </div>
                  </td>
                  <td className="px-2 py-2">
                    <FigureCell
                      figure={r.runHours as Figure<number | null>}
                      decimals
                      label={`${line.machineCode} running hours`}
                      disabled={disabled}
                      onCommit={(v) => save(line, { runHoursEntered: v })}
                    />
                  </td>
                  <td className="px-2 py-2">
                    <FigureCell
                      figure={r.planQty}
                      label={`${line.machineCode} plan quantity`}
                      disabled={disabled}
                      onCommit={(v) => save(line, { planQtyEntered: v })}
                    />
                  </td>
                  <td className="px-2 py-2">
                    <FigureCell
                      figure={r.actualPlanQty}
                      label={`${line.machineCode} actual plan quantity`}
                      disabled={disabled}
                      onCommit={(v) => save(line, { actualPlanQtyEntered: v })}
                    />
                  </td>
                  <td className="px-2 py-2">
                    <FigureCell
                      figure={r.achievedQty as Figure<number | null>}
                      label={`${line.machineCode} achieved quantity`}
                      disabled={disabled}
                      onCommit={(v) => save(line, { achievedQtyEntered: v })}
                    />
                  </td>
                  <td className="px-2 py-2 pt-3.5 text-right font-mono font-semibold tabular-nums">
                    {pct(r.efficiencyPct)}
                  </td>
                  <td className="px-2 py-2">
                    <FigureCell
                      figure={{
                        computed: line.reworkQty,
                        value: line.reworkQty,
                        overridden: false,
                      }}
                      label={`${line.machineCode} rework quantity`}
                      disabled={disabled}
                      onCommit={(v) => save(line, { reworkQty: v ?? 0 })}
                    />
                  </td>
                  <td className="px-2 py-2">
                    <FigureCell
                      figure={{
                        computed: line.rejectionQty,
                        value: line.rejectionQty,
                        overridden: false,
                      }}
                      label={`${line.machineCode} rejection quantity`}
                      disabled={disabled}
                      onCommit={(v) => save(line, { rejectionQty: v ?? 0 })}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <TextCell
                      value={line.ncReason}
                      label={`${line.machineCode} reason for NC part`}
                      disabled={disabled}
                      onCommit={(v) => save(line, { ncReason: v })}
                    />
                  </td>
                </tr>
                {r.warnings.length > 0 ? (
                  <tr>
                    <td />
                    <td colSpan={11} className="px-2 pb-3">
                      <div className="bg-muted/40 space-y-2 rounded-lg p-2.5">
                        <WarningList warnings={r.warnings} />
                        {warnings.length > 0 ? (
                          <div className="flex items-center gap-2">
                            <span className="text-muted-foreground shrink-0 text-xs">
                              Why it differs:
                            </span>
                            <TextCell
                              value={line.warningNote}
                              label={`${line.machineCode} note on warnings`}
                              disabled={disabled}
                              onCommit={(v) => save(line, { warningNote: v })}
                              className="text-xs"
                            />
                          </div>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ) : null}
              </tbody>
            );
          })}
          <tfoot className="border-border bg-muted/30 border-t font-medium">
            <tr>
              <td className="px-3 py-2" colSpan={5}>
                Shift total · {report.machines.filter((m) => m.recorded).length} of{' '}
                {report.machines.length} machines running
              </td>
              <td className="px-2 py-2 text-right font-mono tabular-nums">
                {report.totals.planQty}
              </td>
              <td className="px-2 py-2 text-right font-mono tabular-nums">
                {report.totals.actualPlanQty}
              </td>
              <td className="px-2 py-2 text-right font-mono tabular-nums">
                {report.totals.achievedQty}
              </td>
              <td className="px-2 py-2 text-right font-mono tabular-nums">
                {pct(report.totals.efficiencyPct)}
              </td>
              <td className="px-2 py-2 text-right font-mono tabular-nums">
                {report.totals.reworkQty}
              </td>
              <td className="px-2 py-2 text-right font-mono tabular-nums">
                {report.totals.rejectionQty}
              </td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
