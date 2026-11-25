'use client';

import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { updateRemarksRequest } from '@/lib/api/production-client';
import { formatIST } from '@/lib/utils/time';

import { WarningList } from './final-tab';
import { useReport } from './report-context';

/** Shift remarks, every warning in one place, and what was changed after submission. */
export function ReviewTab() {
  const { report, run, busy } = useReport();
  const [remarks, setRemarks] = useState(report.remarks ?? '');
  useEffect(() => setRemarks(report.remarks ?? ''), [report.remarks]);

  const flagged = report.machines.flatMap((machine) =>
    machine.lines
      .filter((line) => line.result.warnings.length > 0)
      .map((line) => ({ machine: machine.code, line })),
  );

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <section aria-labelledby="warnings-heading" className="space-y-3">
        <h3 id="warnings-heading" className="font-semibold">
          Figures against the formula
          <span className="text-muted-foreground ml-2 text-sm font-normal">
            {report.warningCount} warning{report.warningCount === 1 ? '' : 's'}
          </span>
        </h3>
        {flagged.length === 0 ? (
          <p className="text-muted-foreground border-border bg-card rounded-xl border p-4 text-sm">
            Every figure matches the formula.
          </p>
        ) : (
          <ul className="space-y-2">
            {flagged.map(({ machine, line }) => (
              <li key={line.id} className="border-border bg-card rounded-xl border p-3">
                <p className="mb-1.5 text-sm font-medium">
                  <span className="font-mono">{machine}</span>
                  <span className="text-muted-foreground">
                    {' '}
                    · {line.partLabel ?? 'Idle'} · {line.operatorName ?? 'no operator'}
                  </span>
                </p>
                <WarningList warnings={line.result.warnings} />
                {line.warningNote ? (
                  <p className="border-border mt-2 border-l-2 pl-2 text-xs">
                    Supervisor’s note: {line.warningNote}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="space-y-5">
        <section aria-labelledby="remarks-heading" className="space-y-2">
          <h3 id="remarks-heading" className="font-semibold">
            Shift remarks
          </h3>
          {report.can.edit ? (
            <>
              <Label htmlFor="shift-remarks" className="sr-only">
                Shift remarks
              </Label>
              <Textarea
                id="shift-remarks"
                rows={5}
                value={remarks}
                onChange={(event) => setRemarks(event.target.value)}
                placeholder="Anything the approver and the MD should know about this shift."
              />
              <Button
                variant="outline"
                disabled={busy || remarks === (report.remarks ?? '')}
                onClick={() =>
                  void run(
                    () => updateRemarksRequest(report.id, remarks.trim() || null),
                    'Remarks saved.',
                  )
                }
              >
                Save remarks
              </Button>
            </>
          ) : (
            <p className="border-border bg-card rounded-xl border p-3 text-sm whitespace-pre-wrap">
              {report.remarks ?? 'No remarks.'}
            </p>
          )}
        </section>

        <section aria-labelledby="changes-heading" className="space-y-2">
          <h3 id="changes-heading" className="font-semibold">
            Changed after submission
          </h3>
          {report.changes.length === 0 ? (
            <p className="text-muted-foreground text-sm">Nothing changed since it was submitted.</p>
          ) : (
            <ul className="border-border bg-card divide-border divide-y rounded-xl border text-sm">
              {report.changes.map((change) => (
                <li key={change.id} className="px-3 py-2">
                  <p className="font-medium">{change.label}</p>
                  <p className="text-muted-foreground text-xs">
                    {change.before ?? '—'} →{' '}
                    <span className="text-foreground">{change.after ?? '—'}</span> · {change.by},{' '}
                    {formatIST(new Date(change.at), 'dd MMM, hh:mm a')}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
