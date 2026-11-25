'use client';

import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  addLineRequest,
  addPartRequest,
  clearHourRequest,
  deleteLineRequest,
  recordHourRequest,
  updateLineRequest,
} from '@/lib/api/production-client';
import {
  IDLE_REASON_LABELS,
  IDLE_REASONS,
  idleTotal,
  operationLabel,
  type IdleMinutes,
  type IdleReason,
} from '@/lib/domain/production';
import type { LineDto, PartDto } from '@/lib/services/production/reports';
import { cn } from '@/lib/utils';

import { messageOf, useReport } from './report-context';

export const SELECT_CLASS =
  'border-input bg-card h-10 w-full rounded-md border px-3 text-base md:text-sm focus-visible:border-ring disabled:opacity-50';

function numberOrNull(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === '') return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

// ---------------------------------------------------------------------------
// The tab
// ---------------------------------------------------------------------------

export function HourlyTab() {
  const { report } = useReport();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<LineDto | null>(null);
  const [hour, setHour] = useState<{ line: LineDto; slot: number } | null>(null);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-muted-foreground max-w-2xl text-sm">
          Record each machine every hour: pieces made, and any idle minutes with the reason. The
          final report is worked out from these entries.
        </p>
        {report.can.edit ? (
          <Button onClick={() => setAdding(true)}>
            <Plus className="size-4" aria-hidden />
            Part change
          </Button>
        ) : null}
      </div>

      {report.machines.length === 0 ? (
        <div className="border-border bg-card text-muted-foreground rounded-xl border border-dashed p-8 text-center text-sm">
          No machines in this book yet. Ask the administrator to run the production set-up.
        </div>
      ) : null}

      {report.machines.map((machine) => (
        <section
          key={machine.id}
          aria-labelledby={`machine-${machine.id}`}
          className="border-border bg-card rounded-xl border"
        >
          <header className="border-border flex items-center justify-between gap-3 border-b px-4 py-2.5">
            <h3 id={`machine-${machine.id}`} className="font-mono text-base font-semibold">
              {machine.code}
            </h3>
            {!machine.recorded ? (
              <span className="text-muted-foreground text-xs">
                Not running — fill it in when it starts, or mark it idle in Set-up
              </span>
            ) : machine.missingSlots.length > 0 ? (
              <span className="text-muted-foreground text-xs">
                {machine.missingSlots.length} hour{machine.missingSlots.length === 1 ? '' : 's'} not
                recorded
              </span>
            ) : (
              <span className="text-ok text-xs font-medium">Every hour recorded</span>
            )}
          </header>
          <div className="divide-border divide-y">
            {machine.lines.map((line) => (
              <LineBlock
                key={line.id}
                line={line}
                otherLineSlots={
                  new Set(
                    machine.lines
                      .filter((other) => other.id !== line.id)
                      .flatMap((other) => other.hours.map((h) => h.slot)),
                  )
                }
                canRemove={machine.lines.length > 1}
                onEdit={() => setEditing(line)}
                onHour={(slot) => setHour({ line, slot })}
              />
            ))}
          </div>
        </section>
      ))}

      <LineDialog open={adding} onOpenChange={setAdding} />
      <LineDialog
        open={editing !== null}
        onOpenChange={(open) => !open && setEditing(null)}
        line={editing ?? undefined}
      />
      <HourDialog value={hour} onClose={() => setHour(null)} />
    </div>
  );
}

function setupText(line: LineDto): string {
  const parts: string[] = [];
  if (line.cycleSec !== null || line.loadSec !== null) {
    const cycle = `${line.cycleSec ?? 0}${line.loadSec ? `+${line.loadSec}` : ''} s`;
    parts.push(
      line.result.pcsPerHour.computed !== null
        ? `${cycle} = ${line.result.pcsPerHour.computed}/hr`
        : cycle,
    );
  }
  if (line.standardCycleSec) parts.push(`master ${line.standardCycleSec} s`);
  return parts.join(' · ');
}

function LineBlock({
  line,
  canRemove,
  otherLineSlots,
  onEdit,
  onHour,
}: {
  line: LineDto;
  /** Only a part-change line comes off; every machine of the book stays listed. */
  canRemove: boolean;
  otherLineSlots: Set<number>;
  onEdit: () => void;
  onHour: (slot: number) => void;
}) {
  const { report, run } = useReport();
  const bySlot = new Map(line.hours.map((hour) => [hour.slot, hour]));

  return (
    <div className="space-y-3 px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium">
            {line.partLabel ?? <span className="text-muted-foreground">No part set</span>}
            {line.operation ? (
              <span className="text-muted-foreground"> · Op {line.operationLabel}</span>
            ) : null}
          </p>
          <p className="text-muted-foreground text-sm">
            {line.operatorName ?? 'No operator named'}
            {setupText(line) ? ` · ${setupText(line)}` : ''}
          </p>
        </div>
        {report.can.edit ? (
          <div className="flex gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={onEdit}
              aria-label={`Edit ${line.machineCode} set-up`}
            >
              <Pencil className="size-4" aria-hidden />
              Set-up
            </Button>
            {canRemove ? (
              <Button
                variant="ghost"
                size="sm"
                aria-label={`Remove ${line.machineCode} ${line.partLabel ?? ''} from this shift`}
                onClick={() => {
                  if (
                    window.confirm(
                      `Remove ${line.machineCode} ${line.partLabel ?? ''} and its hours from this shift?`,
                    )
                  ) {
                    void run(() => deleteLineRequest(report.id, line.id), 'Removed.');
                  }
                }}
              >
                <Trash2 className="size-4" aria-hidden />
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>

      <ol className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-12">
        {report.slots.map((slot) => {
          const hour = bySlot.get(slot.slot);
          const takenByOther = !hour && otherLineSlots.has(slot.slot);
          const idle = hour ? idleTotal(hour.idle) : 0;
          const locked =
            !report.can.edit || takenByOther || (report.status === 'DRAFT' && !slot.started);
          return (
            <li key={slot.slot}>
              <button
                type="button"
                disabled={locked}
                onClick={() => onHour(slot.slot)}
                className={cn(
                  'flex h-full w-full flex-col items-start rounded-lg border px-2 py-1.5 text-left transition-colors',
                  hour
                    ? 'border-border bg-muted/40 hover:bg-muted'
                    : slot.started
                      ? 'border-risk-edge bg-risk-soft/40 hover:bg-risk-soft'
                      : 'border-border border-dashed opacity-60',
                  locked && 'cursor-default hover:bg-transparent',
                  hour?.late && 'ring-info-edge ring-1',
                )}
              >
                <span className="text-muted-foreground font-mono text-[11px] leading-4">
                  {slot.label}
                </span>
                <span className="font-mono text-lg font-semibold tabular-nums">
                  {hour ? hour.qty : takenByOther ? '·' : '—'}
                </span>
                <span className="text-muted-foreground text-[11px] leading-4">
                  {hour
                    ? idle > 0
                      ? `${idle} min idle`
                      : hour.late
                        ? 'late entry'
                        : 'running'
                    : takenByOther
                      ? 'other part'
                      : slot.started
                        ? 'to record'
                        : 'not yet'}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

// ---------------------------------------------------------------------------
// One hour
// ---------------------------------------------------------------------------

function HourDialog({
  value,
  onClose,
}: {
  value: { line: LineDto; slot: number } | null;
  onClose: () => void;
}) {
  const { report, run, busy } = useReport();
  const [qty, setQty] = useState('');
  const [idle, setIdle] = useState<Array<{ reason: IdleReason; minutes: string }>>([]);
  const [note, setNote] = useState('');

  const existing = value ? value.line.hours.find((hour) => hour.slot === value.slot) : undefined;
  const slot = value ? report.slots[value.slot] : undefined;

  useEffect(() => {
    if (!value) return;
    setQty(existing ? String(existing.qty) : '');
    setIdle(
      existing
        ? IDLE_REASONS.filter((reason) => (existing.idle[reason] ?? 0) > 0).map((reason) => ({
            reason,
            minutes: String(existing.idle[reason]),
          }))
        : [],
    );
    setNote(existing?.note ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  if (!value || !slot) return null;

  const idleMap: IdleMinutes = {};
  for (const row of idle) {
    const minutes = Number(row.minutes);
    if (minutes > 0) idleMap[row.reason] = (idleMap[row.reason] ?? 0) + minutes;
  }
  const idleSum = idleTotal(idleMap);
  const pcs = value.line.result.pcsPerHour.value;
  const possible = pcs !== null ? Math.floor((pcs * (slot.minutes - idleSum)) / 60) : null;

  async function save() {
    if (!value) return;
    const ok = await run(() =>
      recordHourRequest(report.id, value.line.id, value.slot, {
        qty: Number(qty || 0),
        idle: idleMap,
        note: note.trim() || null,
      }),
    );
    if (ok) onClose();
  }

  async function clear() {
    if (!value) return;
    const ok = await run(() => clearHourRequest(report.id, value.line.id, value.slot));
    if (ok) onClose();
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {value.line.machineCode} · {slot.label}
          </DialogTitle>
          <DialogDescription>
            {value.line.partLabel ?? 'Idle'}
            {possible !== null ? ` · up to ${possible} pcs possible this hour` : ''}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="hour-qty">Pieces made this hour</Label>
            <Input
              id="hour-qty"
              inputMode="numeric"
              autoFocus
              value={qty}
              onChange={(event) => setQty(event.target.value.replace(/[^\d]/g, ''))}
              placeholder="0"
            />
          </div>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Idle time this hour</legend>
            {idle.map((row, index) => (
              <div key={index} className="flex gap-2">
                <select
                  aria-label="Reason"
                  className={SELECT_CLASS}
                  value={row.reason}
                  onChange={(event) =>
                    setIdle(
                      idle.map((r, i) =>
                        i === index ? { ...r, reason: event.target.value as IdleReason } : r,
                      ),
                    )
                  }
                >
                  {IDLE_REASONS.map((reason) => (
                    <option key={reason} value={reason}>
                      {IDLE_REASON_LABELS[reason]}
                    </option>
                  ))}
                </select>
                <Input
                  aria-label="Minutes"
                  inputMode="numeric"
                  className="w-24"
                  value={row.minutes}
                  onChange={(event) =>
                    setIdle(
                      idle.map((r, i) =>
                        i === index
                          ? { ...r, minutes: event.target.value.replace(/[^\d]/g, '') }
                          : r,
                      ),
                    )
                  }
                  placeholder="min"
                />
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Remove this idle reason"
                  onClick={() => setIdle(idle.filter((_, i) => i !== index))}
                >
                  <Trash2 className="size-4" aria-hidden />
                </Button>
              </div>
            ))}
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIdle([...idle, { reason: 'OTHERS', minutes: '15' }])}
              >
                <Plus className="size-4" aria-hidden />
                Add idle reason
              </Button>
              {idleSum > 0 ? (
                <span
                  className={cn(
                    'self-center text-xs',
                    idleSum > slot.minutes ? 'text-late font-medium' : 'text-muted-foreground',
                  )}
                >
                  {idleSum} of {slot.minutes} min idle
                </span>
              ) : null}
            </div>
          </fieldset>

          <div className="space-y-1.5">
            <Label htmlFor="hour-note">Note (optional)</Label>
            <Input
              id="hour-note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="e.g. tool changed"
            />
          </div>
        </div>

        <DialogFooter className="gap-2">
          {existing && report.status === 'DRAFT' ? (
            <Button variant="ghost" onClick={clear} disabled={busy}>
              Clear hour
            </Button>
          ) : null}
          <Button onClick={save} disabled={busy || idleSum > slot.minutes}>
            Save hour
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// A machine's set-up
// ---------------------------------------------------------------------------

function partOption(part: PartDto): string {
  const name = part.partNumber ? `${part.partName} | ${part.partNumber}` : part.partName;
  const cycle = part.standardCycleSec ? ` · ${part.standardCycleSec} s` : ' · no cycle time';
  return `${name} · Op ${operationLabel(part.operation)}${cycle}${part.addedFromFloor ? ' · new' : ''}`;
}

const NEW_PART = '__new__';

function LineDialog({
  open,
  onOpenChange,
  line,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  line?: LineDto;
}) {
  const { report, parts, setParts, run, busy } = useReport();
  const [machineId, setMachineId] = useState('');
  const [operator, setOperator] = useState('');
  const [partId, setPartId] = useState('');
  const [cycle, setCycle] = useState('');
  const [load, setLoad] = useState('');
  const [idleReason, setIdleReason] = useState<IdleReason | ''>('');
  const [newPart, setNewPart] = useState({ name: '', number: '', operation: '1', cycle: '' });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setMachineId(line?.machineId ?? '');
    setOperator(line?.operatorName ?? '');
    setPartId(line?.partId ?? '');
    setCycle(line?.cycleSec !== null && line?.cycleSec !== undefined ? String(line.cycleSec) : '');
    setLoad(line?.loadSec !== null && line?.loadSec !== undefined ? String(line.loadSec) : '');
    setIdleReason('');
    setNewPart({ name: '', number: '', operation: '1', cycle: '' });
    setError(null);
  }, [open, line]);

  const usedMachines = useMemo(
    () => new Set(report.machines.map((machine) => machine.id)),
    [report.machines],
  );
  const chosen = parts.find((part) => part.id === partId);
  const machineRecorded = line
    ? (report.machines.find((machine) => machine.id === line.machineId)?.recorded ?? false)
    : false;

  async function save() {
    setError(null);
    if (!line && !machineId) return setError('Pick the machine.');

    let resolvedPartId: string | null = partId && partId !== NEW_PART ? partId : null;
    if (partId === NEW_PART) {
      if (!newPart.name.trim()) return setError('Enter the new part’s name.');
      try {
        const created = await addPartRequest({
          section: report.section,
          customer: null,
          partName: newPart.name.trim(),
          partNumber: newPart.number.trim() || null,
          operation: Number(newPart.operation),
          standardCycleSec: numberOrNull(newPart.cycle),
        });
        setParts([...parts, created]);
        resolvedPartId = created.id;
      } catch (caught) {
        return setError(messageOf(caught));
      }
    }

    const common = {
      operatorName: operator.trim() || null,
      partId: resolvedPartId,
      cycleSec: numberOrNull(cycle),
      loadSec: numberOrNull(load),
    };
    const ok = line
      ? await run(
          () =>
            updateLineRequest(report.id, line.id, {
              ...common,
              ...(idleReason ? { idleAllShift: idleReason } : {}),
            }),
          'Set-up saved.',
        )
      : await run(
          () =>
            addLineRequest(report.id, {
              machineId,
              ...common,
              idleAllShift: idleReason || null,
            }),
          'Part change added.',
        );
    if (ok) onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {line ? `${line.machineCode} set-up` : 'Part change on a machine'}
          </DialogTitle>
          <DialogDescription>
            {line
              ? 'Change the operator, part or cycle time. The hours already recorded stay.'
              : 'Every machine is already listed. Use this when a machine changes part during the shift: the new part gets its own line and hours.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {!line ? (
            <div className="space-y-1.5">
              <Label htmlFor="line-machine">Machine</Label>
              <select
                id="line-machine"
                className={SELECT_CLASS}
                value={machineId}
                onChange={(event) => setMachineId(event.target.value)}
              >
                <option value="">Pick a machine…</option>
                {report.allMachines.map((machine) => (
                  <option key={machine.id} value={machine.id}>
                    {machine.code}
                    {usedMachines.has(machine.id) ? ' (part change)' : ''}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          <div className="space-y-1.5">
            <Label htmlFor="line-operator">Operator</Label>
            <Input
              id="line-operator"
              value={operator}
              onChange={(event) => setOperator(event.target.value)}
              placeholder="Operator name"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="line-part">Part</Label>
            <select
              id="line-part"
              className={SELECT_CLASS}
              value={partId}
              onChange={(event) => setPartId(event.target.value)}
            >
              <option value="">{line ? 'No part (idle)' : 'Pick a part…'}</option>
              {parts.map((part) => (
                <option key={part.id} value={part.id}>
                  {partOption(part)}
                </option>
              ))}
              <option value={NEW_PART}>+ Part not in the list…</option>
            </select>
            {chosen?.standardCycleSec ? (
              <p className="text-muted-foreground text-xs">
                Master cycle time: {chosen.standardCycleSec} s ={' '}
                {Math.floor(3600 / chosen.standardCycleSec)} pcs/hr
              </p>
            ) : null}
          </div>

          {partId === NEW_PART ? (
            <fieldset className="border-border space-y-3 rounded-lg border p-3">
              <legend className="px-1 text-sm font-medium">New part (shown to the approver)</legend>
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2 space-y-1.5">
                  <Label htmlFor="np-name">Part name</Label>
                  <Input
                    id="np-name"
                    value={newPart.name}
                    onChange={(e) => setNewPart({ ...newPart, name: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="np-number">Part number</Label>
                  <Input
                    id="np-number"
                    value={newPart.number}
                    onChange={(e) => setNewPart({ ...newPart, number: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="np-op">Operation</Label>
                  <select
                    id="np-op"
                    className={SELECT_CLASS}
                    value={newPart.operation}
                    onChange={(e) => setNewPart({ ...newPart, operation: e.target.value })}
                  >
                    {[1, 2, 3, 4].map((op) => (
                      <option key={op} value={op}>
                        Op {operationLabel(op)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="col-span-2 space-y-1.5">
                  <Label htmlFor="np-cycle">Standard cycle time, seconds (if known)</Label>
                  <Input
                    id="np-cycle"
                    inputMode="decimal"
                    value={newPart.cycle}
                    onChange={(e) => setNewPart({ ...newPart, cycle: e.target.value })}
                  />
                </div>
              </div>
            </fieldset>
          ) : null}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="line-cycle">Machining, sec</Label>
              <Input
                id="line-cycle"
                inputMode="decimal"
                value={cycle}
                onChange={(e) => setCycle(e.target.value)}
                placeholder="e.g. 55"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="line-load">Loading, sec</Label>
              <Input
                id="line-load"
                inputMode="decimal"
                value={load}
                onChange={(e) => setLoad(e.target.value)}
                placeholder="e.g. 10"
              />
            </div>
            {numberOrNull(cycle) !== null ? (
              <p className="text-muted-foreground col-span-2 text-xs">
                {(numberOrNull(cycle) ?? 0) + (numberOrNull(load) ?? 0)} s per piece ={' '}
                {Math.floor(3600 / ((numberOrNull(cycle) ?? 0) + (numberOrNull(load) ?? 0) || 1))}{' '}
                pcs/hr
                {(chosen?.standardCycleSec ?? null) !== null &&
                Math.abs(
                  (numberOrNull(cycle) ?? 0) +
                    (numberOrNull(load) ?? 0) -
                    (chosen?.standardCycleSec ?? 0),
                ) >= 1 ? (
                  <span className="text-risk font-medium">
                    {' '}
                    · differs from the master ({chosen?.standardCycleSec} s)
                  </span>
                ) : null}
              </p>
            ) : null}
          </div>

          {!line || !machineRecorded ? (
            <div className="space-y-1.5">
              <Label htmlFor="line-idle">Idle the whole shift? (optional)</Label>
              <select
                id="line-idle"
                className={SELECT_CLASS}
                value={idleReason}
                onChange={(event) => setIdleReason(event.target.value as IdleReason | '')}
              >
                <option value="">No — it is running</option>
                {IDLE_REASONS.map((reason) => (
                  <option key={reason} value={reason}>
                    Idle all shift: {IDLE_REASON_LABELS[reason]}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          {error ? (
            <p className="text-late text-sm" role="alert">
              {error}
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button onClick={save} disabled={busy}>
            {line ? 'Save set-up' : 'Add part change'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
