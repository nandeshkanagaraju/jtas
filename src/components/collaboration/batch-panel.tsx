'use client';

import { T } from '@/lib/i18n/provider';

import { CheckCircle2, Loader2, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from '@/lib/i18n/toast';

import { IstDateTimePicker } from '@/components/shared/ist-datetime-picker';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError, apiFetch, apiPost } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { deadlineLabel } from '@/lib/utils/relative-time';
import { formatIST } from '@/lib/utils/time';
import { closeBatchSchema } from '@/lib/validation/batch';

interface BatchDto {
  id: string;
  sequence: number;
  quantity: number;
  deadline: string;
  completedAt: string | null;
  acceptedQty: number;
  rejectedQty: number;
  note: string | null;
  closedBy: string | null;
}

interface BatchesDto {
  jobQuantity: number | null;
  plannedQuantity: number;
  batches: BatchDto[];
}

interface DraftRow {
  key: number;
  quantity: string;
  deadline: string;
}

let nextKey = 1;
const blankRow = (quantity = ''): DraftRow => ({ key: nextKey++, quantity, deadline: '' });

/**
 * Production and Quality plan their task as dated batches and close each one
 * with its accepted and rejected pieces. The task's deadline is always the
 * earliest open batch.
 */
export function BatchPanel({
  subtaskId,
  departmentName,
  canPlan,
  canReplan,
  canClose,
  onChanged,
}: {
  subtaskId: string;
  departmentName: string;
  /** The holder, while their turn is open and nothing is planned yet. */
  canPlan: boolean;
  /** The MD or a job manager: may re-plan the open batches with a reason. */
  canReplan: boolean;
  canClose: boolean;
  onChanged: () => void;
}) {
  const [state, setState] = useState<BatchesDto | null>(null);
  const [planning, setPlanning] = useState(false);

  useEffect(() => {
    let live = true;
    apiFetch<{ data: BatchesDto }>(`/api/subtasks/${subtaskId}/batches`)
      .then((result) => live && setState(result.data))
      .catch(() => live && setState({ jobQuantity: null, plannedQuantity: 0, batches: [] }));
    return () => {
      live = false;
    };
  }, [subtaskId]);

  if (!state) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

  const open = state.batches.filter((batch) => !batch.completedAt);
  const closed = state.batches.length - open.length;
  const accepted = state.batches.reduce((sum, batch) => sum + batch.acceptedQty, 0);
  const rejected = state.batches.reduce((sum, batch) => sum + batch.rejectedQty, 0);
  const showPlanner = planning || (canPlan && state.batches.length === 0);

  function refreshed(next: BatchesDto) {
    setState(next);
    setPlanning(false);
    onChanged();
  }

  return (
    <div className="space-y-4">
      {state.batches.length > 0 ? (
        <div className="grid grid-cols-3 gap-2">
          <Total
            label={`Batches closed`}
            value={`${closed} / ${state.batches.length}`}
            tone="text-foreground"
          />
          <Total label="Accepted" value={String(accepted)} tone="text-ok" />
          <Total label="Rejected" value={String(rejected)} tone="text-late" />
        </div>
      ) : null}

      {showPlanner ? (
        <BatchPlanner
          subtaskId={subtaskId}
          departmentName={departmentName}
          jobQuantity={state.jobQuantity}
          replanning={state.batches.length > 0}
          openBatches={open}
          onCancel={planning ? () => setPlanning(false) : undefined}
          onSaved={refreshed}
        />
      ) : null}

      {state.batches.length > 0 ? (
        <ol className="divide-border divide-y" aria-label="Batches">
          {state.batches.map((batch) => (
            <BatchItem
              key={batch.id}
              subtaskId={subtaskId}
              batch={batch}
              canClose={canClose}
              onClosed={refreshed}
            />
          ))}
        </ol>
      ) : !showPlanner ? (
        <p className="text-muted-foreground text-sm">
          <T>{'No batches planned yet. They are planned when this step’s turn arrives.'}</T>
        </p>
      ) : null}

      {state.batches.length > 0 && state.jobQuantity ? (
        <p className="text-muted-foreground text-xs">
          <T>{'Planned'}</T> {state.plannedQuantity} <T>{'of'}</T> {state.jobQuantity}{' '}
          <T>{'pieces on the job.'}</T>
        </p>
      ) : null}

      {canReplan && !planning && !showPlanner && (open.length > 0 || state.batches.length === 0) ? (
        <Button variant="outline" size="sm" onClick={() => setPlanning(true)}>
          <T>{state.batches.length === 0 ? 'Plan batches' : 'Change open batches'}</T>
        </Button>
      ) : null}

      {open.length === 0 && state.batches.length > 0 ? (
        <p className="text-sm font-medium">
          <T>{'Every batch is closed. Mark the task completed when the work is handed over.'}</T>
        </p>
      ) : null}
    </div>
  );
}

function Total({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="border-border bg-card rounded-lg border px-3 py-2">
      <p className="text-muted-foreground text-xs">
        <T>{label}</T>
      </p>
      <p className={`font-mono text-xl font-semibold tabular-nums ${tone}`}>{value}</p>
    </div>
  );
}

function BatchItem({
  subtaskId,
  batch,
  canClose,
  onClosed,
}: {
  subtaskId: string;
  batch: BatchDto;
  canClose: boolean;
  onClosed: (next: BatchesDto) => void;
}) {
  const [closing, setClosing] = useState(false);
  const [accepted, setAccepted] = useState('');
  const [rejected, setRejected] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const due = new Date(batch.deadline);
  const label = deadlineLabel(due);
  const late = !batch.completedAt && label.overdue;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const parsed = closeBatchSchema.safeParse({
      acceptedQty: accepted.trim() === '' ? 0 : accepted,
      rejectedQty: rejected.trim() === '' ? 0 : rejected,
      note,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Check the quantities.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const { data } = await apiPost<{ data: BatchesDto }>(
        `/api/subtasks/${subtaskId}/batches/${batch.id}/close`,
        parsed.data,
      );
      toast.success(`Batch ${batch.sequence} closed`);
      onClosed(data);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Could not close the batch.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <li className="space-y-2 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-medium">
            <T>{'Batch'}</T> {batch.sequence} · {batch.quantity} <T>{'pcs'}</T>
          </p>
          <p className={cn('text-sm tabular-nums', late ? 'text-late' : 'text-muted-foreground')}>
            {formatIST(due)}
            {batch.completedAt ? null : ` · ${label.text}`}
          </p>
        </div>
        {batch.completedAt ? (
          <Badge variant="outline" className="gap-1">
            <CheckCircle2 className="text-ok size-3.5" aria-hidden />
            <T>{'Closed'}</T>
          </Badge>
        ) : late ? (
          <Badge variant="late">
            <T>{'Overdue'}</T>
          </Badge>
        ) : (
          <Badge variant="outline">
            <T>{'Open'}</T>
          </Badge>
        )}
      </div>

      {batch.completedAt ? (
        <p className="text-sm">
          <span className="text-ok font-medium">
            <T>{'Accepted'}</T> {batch.acceptedQty}
          </span>
          {' · '}
          <span className="text-late font-medium">
            <T>{'Rejected'}</T> {batch.rejectedQty}
          </span>
          <span className="text-muted-foreground">
            {' · '}
            {batch.closedBy ? `${batch.closedBy} · ` : ''}
            {formatIST(new Date(batch.completedAt))}
            {batch.note ? ` · ${batch.note}` : ''}
          </span>
        </p>
      ) : canClose && !closing ? (
        <Button size="sm" onClick={() => setClosing(true)}>
          <T>{'Close batch'}</T>
        </Button>
      ) : null}

      {closing && !batch.completedAt ? (
        <form onSubmit={submit} className="space-y-3" aria-label={`Close batch ${batch.sequence}`}>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor={`batch-accepted-${batch.id}`}>
                <T>{'Accepted'}</T>
              </Label>
              <Input
                id={`batch-accepted-${batch.id}`}
                inputMode="numeric"
                pattern="[0-9]*"
                placeholder={String(batch.quantity)}
                value={accepted}
                onChange={(event) => setAccepted(event.target.value.replace(/\D/g, ''))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`batch-rejected-${batch.id}`}>
                <T>{'Rejected'}</T>
              </Label>
              <Input
                id={`batch-rejected-${batch.id}`}
                inputMode="numeric"
                pattern="[0-9]*"
                placeholder="0"
                value={rejected}
                onChange={(event) => setRejected(event.target.value.replace(/\D/g, ''))}
              />
            </div>
          </div>
          <Input
            aria-label="Reason or note (optional)"
            maxLength={500}
            placeholder="Reason or note (optional)"
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
          {error ? (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          ) : null}
          <div className="flex gap-2">
            <Button type="submit" disabled={saving}>
              {saving ? <Loader2 className="size-4 animate-spin" /> : null}
              <T>{'Close batch'}</T>
            </Button>
            <Button type="button" variant="ghost" onClick={() => setClosing(false)}>
              <T>{'Cancel '}</T>
            </Button>
          </div>
        </form>
      ) : null}
    </li>
  );
}

function BatchPlanner({
  subtaskId,
  departmentName,
  jobQuantity,
  replanning,
  openBatches,
  onCancel,
  onSaved,
}: {
  subtaskId: string;
  departmentName: string;
  jobQuantity: number | null;
  replanning: boolean;
  openBatches: BatchDto[];
  onCancel?: () => void;
  onSaved: (next: BatchesDto) => void;
}) {
  const [rows, setRows] = useState<DraftRow[]>(() =>
    replanning
      ? openBatches.map((batch) => ({
          key: nextKey++,
          quantity: String(batch.quantity),
          deadline: formatIST(new Date(batch.deadline), "yyyy-MM-dd'T'HH:mm"),
        }))
      : [blankRow(jobQuantity ? String(jobQuantity) : '')],
  );
  const [reason, setReason] = useState('');
  const [overrideReason, setOverrideReason] = useState('');
  const [needsOverride, setNeedsOverride] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const planned = rows.reduce((sum, row) => sum + (Number(row.quantity) || 0), 0);
  const complete = rows.every((row) => Number(row.quantity) > 0 && row.deadline !== '');

  const update = (key: number, patch: Partial<DraftRow>) =>
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const { data } = await apiPost<{ data: BatchesDto }>(`/api/subtasks/${subtaskId}/batches`, {
        batches: rows.map((row) => ({ quantity: row.quantity, deadline: row.deadline })),
        reason: replanning ? reason : undefined,
        deadlineOverrideReason: needsOverride && overrideReason ? overrideReason : undefined,
      });
      toast.success(replanning ? 'Batches updated' : 'Batch dates committed');
      onSaved(data);
    } catch (cause) {
      if (
        cause instanceof ApiError &&
        (cause.details as { requiresOverride?: string } | undefined)?.requiresOverride
      ) {
        setNeedsOverride(true);
      }
      setError(cause instanceof ApiError ? cause.message : 'Could not save the batches.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="border-primary space-y-3 rounded-lg border p-3">
      <div>
        <p className="font-medium">
          <T>{replanning ? 'Change the open batches' : 'Plan your batches'}</T>
        </p>
        <p className="text-muted-foreground text-sm">
          {departmentName === 'Quality' ? (
            <T>{'One row per lot: how many pieces, and the day it goes for inspection.'}</T>
          ) : (
            <T>{'One row per batch: how many pieces, and when that batch will be ready.'}</T>
          )}{' '}
          {replanning ? null : (
            <T>{'Once committed you cannot move them yourself — ask the MD for more time.'}</T>
          )}
        </p>
      </div>

      <ol className="space-y-3">
        {rows.map((row, index) => (
          <li key={row.key} className="grid gap-2 sm:grid-cols-[7rem_1fr_auto] sm:items-end">
            <div className="space-y-1.5">
              <Label htmlFor={`plan-qty-${row.key}`} className="text-xs">
                <T>{'Batch'}</T> {index + 1} · <T>{'pcs'}</T>
              </Label>
              <Input
                id={`plan-qty-${row.key}`}
                inputMode="numeric"
                pattern="[0-9]*"
                value={row.quantity}
                onChange={(event) =>
                  update(row.key, { quantity: event.target.value.replace(/\D/g, '') })
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`plan-date-${row.key}`} className="text-xs">
                <T>{'Date (IST)'}</T>
              </Label>
              <IstDateTimePicker
                id={`plan-date-${row.key}`}
                value={row.deadline}
                onChange={(deadline) => update(row.key, { deadline })}
              />
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`Remove batch ${index + 1}`}
              disabled={rows.length === 1}
              onClick={() => setRows((current) => current.filter((item) => item.key !== row.key))}
            >
              <Trash2 className="size-4" />
            </Button>
          </li>
        ))}
      </ol>

      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setRows((current) => [...current, blankRow()])}
        >
          <Plus className="size-4" />
          <T>{'Add batch'}</T>
        </Button>
        <span
          className={cn(
            'text-sm tabular-nums',
            jobQuantity && planned !== jobQuantity ? 'text-late' : 'text-muted-foreground',
          )}
        >
          <T>{'Planned'}</T> {planned}
          {jobQuantity ? ` / ${jobQuantity}` : ''} <T>{'pcs'}</T>
        </span>
      </div>

      {replanning ? (
        <Input
          aria-label="Reason for the change"
          placeholder="Reason for the change (goes on the record)"
          maxLength={500}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
      ) : null}
      {needsOverride ? (
        <Input
          aria-label="Why a batch is after the job deadline"
          placeholder="Why a batch is after the job deadline"
          maxLength={500}
          value={overrideReason}
          onChange={(event) => setOverrideReason(event.target.value)}
        />
      ) : null}

      {error ? (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : null}

      <div className="flex gap-2">
        <Button
          className="min-h-11"
          disabled={saving || !complete || (replanning && reason.trim().length < 5)}
          onClick={() => void save()}
        >
          {saving ? <Loader2 className="size-4 animate-spin" /> : null}
          <T>{replanning ? 'Save batches' : 'Commit these dates'}</T>
        </Button>
        {onCancel ? (
          <Button variant="ghost" className="min-h-11" onClick={onCancel}>
            <T>{'Cancel '}</T>
          </Button>
        ) : null}
      </div>
    </div>
  );
}
