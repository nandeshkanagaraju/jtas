'use client';

import { T } from '@/lib/i18n/provider';

import { Loader2, PackageCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from '@/lib/i18n/toast';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError, apiFetch, apiPost } from '@/lib/api/client';
import { addMaterialCountSchema } from '@/lib/validation/materials';
import { formatIST, IST_DATE_PATTERN, istDateKey } from '@/lib/utils/time';

export interface MaterialCountDto {
  id: string;
  acceptedQty: number;
  rejectedQty: number;
  note: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  createdAt: string;
  recordedBy: { id: string; name: string };
}

/** "HH:mm" in IST, `minutes` after `base`'s minute. */
function istTime(base: Date, minutes = 0): string {
  return formatIST(new Date(base.getTime() + minutes * 60_000), 'HH:mm');
}

/**
 * The next slot to report: on from where today's last slot ended, otherwise the
 * hour that has just finished (at 5:45 PM, 4:00–5:00 PM).
 */
function nextSlot(entries: MaterialCountDto[], now: Date): { from: string; to: string } {
  const lastEnd = entries.find((entry) => entry.periodEnd)?.periodEnd;
  if (lastEnd && istDateKey(new Date(lastEnd)) === istDateKey(now)) {
    const from = new Date(lastEnd);
    return { from: istTime(from), to: istTime(from, 60) };
  }
  const hourStart = new Date(now.getTime() - Number(formatIST(now, 'm')) * 60_000);
  return { from: istTime(hourStart, -60), to: istTime(hourStart) };
}

function slotLabel(entry: MaterialCountDto): string | null {
  if (!entry.periodStart || !entry.periodEnd) return null;
  return `${formatIST(new Date(entry.periodStart), 'h:mm a')} – ${formatIST(new Date(entry.periodEnd), 'h:mm a')}`;
}

interface MaterialsDto {
  jobQuantity: number | null;
  totals: { accepted: number; rejected: number };
  entries: MaterialCountDto[];
}

function Total({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="border-border bg-card rounded-lg border px-3 py-2">
      <p className="text-muted-foreground text-xs">
        <T>{label}</T>
      </p>
      <p className={`font-mono text-xl font-semibold tabular-nums ${tone}`}>{value}</p>
    </div>
  );
}

/**
 * Accepted and rejected material on a Production, Quality or QA task. Each
 * report is kept (a shift, a batch); the totals are their sum.
 */
export function MaterialCountPanel({
  subtaskId,
  canRecord,
  hourly = false,
}: {
  subtaskId: string;
  canRecord: boolean;
  /** QA: one report every hour, so show when the last one went in. */
  hourly?: boolean;
}) {
  const [materials, setMaterials] = useState<MaterialsDto | null>(null);
  const [accepted, setAccepted] = useState('');
  const [rejected, setRejected] = useState('');
  const [note, setNote] = useState('');
  const [timeFrom, setTimeFrom] = useState('');
  const [timeTo, setTimeTo] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let live = true;
    apiFetch<{ data: MaterialsDto }>(`/api/subtasks/${subtaskId}/materials`)
      .then((result) => {
        if (!live) return;
        setMaterials(result.data);
        if (hourly) {
          const slot = nextSlot(result.data.entries, new Date());
          setTimeFrom(slot.from);
          setTimeTo(slot.to);
        }
      })
      .catch(
        () =>
          live &&
          setMaterials({ jobQuantity: null, totals: { accepted: 0, rejected: 0 }, entries: [] }),
      );
    return () => {
      live = false;
    };
  }, [subtaskId, hourly]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const parsed = addMaterialCountSchema.safeParse({
      acceptedQty: accepted.trim() === '' ? 0 : accepted,
      rejectedQty: rejected.trim() === '' ? 0 : rejected,
      note,
      ...(hourly ? { timeFrom, timeTo } : {}),
    });
    if (hourly && (!timeFrom || !timeTo)) {
      setError('Enter the from and to time this report covers.');
      return;
    }
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Check the quantities.');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const { data } = await apiPost<{ data: MaterialCountDto }>(
        `/api/subtasks/${subtaskId}/materials`,
        parsed.data,
      );
      setMaterials((current) =>
        current
          ? {
              ...current,
              totals: {
                accepted: current.totals.accepted + data.acceptedQty,
                rejected: current.totals.rejected + data.rejectedQty,
              },
              entries: [data, ...current.entries],
            }
          : current,
      );
      setAccepted('');
      setRejected('');
      setNote('');
      if (hourly && data.periodEnd) {
        const from = new Date(data.periodEnd);
        setTimeFrom(istTime(from));
        setTimeTo(istTime(from, 60));
      }
      toast.success('Material count recorded');
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Could not record the count.');
    } finally {
      setSaving(false);
    }
  }

  if (!materials) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

  const { totals, jobQuantity, entries } = materials;
  const inspected = totals.accepted + totals.rejected;
  const last = entries[0] ? new Date(entries[0].createdAt) : null;
  const minutesSince = last ? Math.floor((Date.now() - last.getTime()) / 60_000) : null;
  const hourDue = minutesSince === null || minutesSince >= 60;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2">
        <Total label="Accepted" value={totals.accepted} tone="text-ok" />
        <Total label="Rejected" value={totals.rejected} tone="text-late" />
        <Total
          label={jobQuantity ? `Counted of ${jobQuantity}` : 'Counted'}
          value={inspected}
          tone="text-foreground"
        />
      </div>

      {hourly ? (
        <p
          className={`text-sm ${hourDue && canRecord ? 'text-late font-medium' : 'text-muted-foreground'}`}
        >
          {last ? (
            <>
              <T>{'Last report'}</T> {formatIST(last, 'h:mm a')} (
              {minutesSince! < 60
                ? `${minutesSince} min ago`
                : `${Math.floor(minutesSince! / 60)} h ${minutesSince! % 60} min ago`}
              ).{' '}
              <T>
                {hourDue ? 'The next hourly report is due now.' : 'Next one due within the hour.'}
              </T>
            </>
          ) : (
            <T>{'No hourly report yet today. Send the first one now.'}</T>
          )}
        </p>
      ) : null}

      {canRecord ? (
        <form onSubmit={submit} className="space-y-3" aria-label="Record material count">
          {hourly ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label>
                  <T>{'Date'}</T>
                </Label>
                <p className="border-border bg-muted/40 flex h-9 items-center rounded-md border px-3 text-sm">
                  {formatIST(new Date(), IST_DATE_PATTERN)}
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`time-from-${subtaskId}`}>
                  <T>{'From'}</T>
                </Label>
                <Input
                  id={`time-from-${subtaskId}`}
                  type="time"
                  required
                  value={timeFrom}
                  onChange={(event) => setTimeFrom(event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`time-to-${subtaskId}`}>
                  <T>{'To'}</T>
                </Label>
                <Input
                  id={`time-to-${subtaskId}`}
                  type="time"
                  required
                  value={timeTo}
                  onChange={(event) => setTimeTo(event.target.value)}
                />
              </div>
            </div>
          ) : null}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor={`accepted-${subtaskId}`}>
                <T>{'Accepted'}</T>
              </Label>
              <Input
                id={`accepted-${subtaskId}`}
                inputMode="numeric"
                pattern="[0-9]*"
                placeholder="0"
                value={accepted}
                onChange={(event) => setAccepted(event.target.value.replace(/\D/g, ''))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`rejected-${subtaskId}`}>
                <T>{'Rejected'}</T>
              </Label>
              <Input
                id={`rejected-${subtaskId}`}
                inputMode="numeric"
                pattern="[0-9]*"
                placeholder="0"
                value={rejected}
                onChange={(event) => setRejected(event.target.value.replace(/\D/g, ''))}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`material-note-${subtaskId}`}>
              <T>{'Reason or note (optional)'}</T>
            </Label>
            <Input
              id={`material-note-${subtaskId}`}
              maxLength={500}
              placeholder="e.g. 2 rejected for oversize bore"
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </div>
          {error ? (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          ) : null}
          <Button type="submit" disabled={saving}>
            {saving ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <PackageCheck className="size-4" />
            )}
            <T>{hourly ? 'Send hourly report' : 'Record count'}</T>
          </Button>
        </form>
      ) : null}

      {entries.length > 0 ? (
        <ul className="divide-border divide-y text-sm" aria-label="Material count history">
          {entries.map((entry) => (
            <li key={entry.id} className="py-2">
              <p>
                {slotLabel(entry) ? (
                  <span className="font-medium">{slotLabel(entry)} · </span>
                ) : null}
                <span className="text-ok font-medium">
                  <T>{'Accepted'}</T> {entry.acceptedQty}
                </span>
                {' · '}
                <span className="text-late font-medium">
                  <T>{'Rejected'}</T> {entry.rejectedQty}
                </span>
                {entry.note ? <span className="text-muted-foreground"> · {entry.note}</span> : null}
              </p>
              <p className="text-muted-foreground text-xs">
                {entry.recordedBy.name} · {formatIST(new Date(entry.createdAt))}
              </p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground text-sm">
          <T>{'No counts recorded yet.'}</T>
        </p>
      )}
    </div>
  );
}
