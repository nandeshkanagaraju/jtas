'use client';

import {
  ChevronDown,
  ChevronRight,
  Download,
  Factory,
  Loader2,
  PackagePlus,
  Trash2,
  Truck,
} from 'lucide-react';
import { Fragment, useCallback, useEffect, useState } from 'react';

import { Panel } from '@/components/shared/panel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError, apiFetch } from '@/lib/api/client';
import { downloadFile } from '@/lib/api/download';
import { T } from '@/lib/i18n/provider';
import { toast } from '@/lib/i18n/toast';
import type {
  StockEntryRow,
  StockLedger,
  StockPart,
} from '@/lib/services/shop-reports/stock-ledger';
import { formatIST, fromISTInput, IST_DATE_PATTERN } from '@/lib/utils/time';

const day = (key: string) => formatIST(fromISTInput(`${key}T00:00`), IST_DATE_PATTERN);
const n = (value: number) => value.toLocaleString('en-IN');

function Num({ value, tone }: { value: number; tone?: string }) {
  return (
    <td
      className={`px-3 py-2 text-right font-mono tabular-nums ${value < 0 ? 'text-late font-semibold' : (tone ?? '')}`}
    >
      {n(value)}
    </td>
  );
}

function OpeningForm({
  today,
  initial,
  onSaved,
  onCancel,
}: {
  today: string;
  initial: StockPart | null;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [partNumber, setPartNumber] = useState(initial?.partNumber ?? '');
  const [partName, setPartName] = useState(initial?.partName ?? '');
  const [asOfDate, setAsOfDate] = useState(initial?.openingSet?.asOfDate ?? today);
  const [rmQty, setRmQty] = useState(String(initial?.openingSet?.rmQty ?? ''));
  const [fgQty, setFgQty] = useState(String(initial?.openingSet?.fgQty ?? ''));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await apiFetch('/api/stock/openings', {
        method: 'PUT',
        body: JSON.stringify({
          partNumber,
          partName: partName || undefined,
          asOfDate,
          rmQty: rmQty.trim() === '' ? 0 : rmQty,
          fgQty: fgQty.trim() === '' ? 0 : fgQty,
        }),
      });
      toast.success('Opening stock saved');
      onSaved();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Could not save the opening stock.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3" aria-label="Opening stock">
      <p className="text-muted-foreground text-sm">
        <T>
          {
            'The stock physically in hand at the start of the date you choose. Store receipts, production and dispatches from that date on are counted from it; anything earlier is taken to be inside this figure.'
          }
        </T>
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-5">
        <div className="space-y-1.5 sm:col-span-1">
          <Label htmlFor="opening-part">
            <T>{'Part number'}</T>
          </Label>
          <Input
            id="opening-part"
            required
            value={partNumber}
            readOnly={Boolean(initial?.partNumber)}
            onChange={(event) => setPartNumber(event.target.value)}
          />
        </div>
        <div className="space-y-1.5 sm:col-span-1">
          <Label htmlFor="opening-name">
            <T>{'Part name'}</T>
          </Label>
          <Input id="opening-name" value={partName} onChange={(e) => setPartName(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="opening-date">
            <T>{'As on (start of day)'}</T>
          </Label>
          <Input
            id="opening-date"
            type="date"
            required
            max={today}
            value={asOfDate}
            onChange={(e) => setAsOfDate(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="opening-rm">
            <T>{'RM in hand (pcs)'}</T>
          </Label>
          <Input
            id="opening-rm"
            inputMode="numeric"
            placeholder="0"
            value={rmQty}
            onChange={(e) => setRmQty(e.target.value.replace(/\D/g, ''))}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="opening-fg">
            <T>{'FG made, not sent (pcs)'}</T>
          </Label>
          <Input
            id="opening-fg"
            inputMode="numeric"
            placeholder="0"
            value={fgQty}
            onChange={(e) => setFgQty(e.target.value.replace(/\D/g, ''))}
          />
        </div>
      </div>
      {error ? (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : null}
      <div className="flex gap-2">
        <Button type="submit" disabled={saving}>
          {saving ? <Loader2 className="size-4 animate-spin" /> : null}
          <T>{'Save opening stock'}</T>
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          <T>{'Cancel'}</T>
        </Button>
      </div>
    </form>
  );
}

interface KnownPart {
  partNumber: string;
  partName: string;
}

export interface StockPermissions {
  setOpening: boolean;
  recordProduced: boolean;
  recordDispatch: boolean;
  removeAny: boolean;
}

/** Production's "made today" or a dispatch, against one part. */
function MovementForm({
  kind,
  today,
  parts,
  onSaved,
  onCancel,
}: {
  kind: 'PRODUCED' | 'DISPATCHED';
  today: string;
  parts: KnownPart[];
  onSaved: () => void;
  onCancel: () => void;
}) {
  const produced = kind === 'PRODUCED';
  const [partNumber, setPartNumber] = useState('');
  const [date, setDate] = useState(today);
  const [quantity, setQuantity] = useState('');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const listId = `parts-${kind}`;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    const known = parts.find((p) => p.partNumber.toLowerCase() === partNumber.trim().toLowerCase());
    try {
      await apiFetch('/api/stock/movements', {
        method: 'POST',
        body: JSON.stringify({
          kind,
          partNumber,
          partName: known?.partName,
          date,
          quantity,
          reference: reference || undefined,
          note: note || undefined,
        }),
      });
      toast.success(produced ? 'Production recorded' : 'Dispatch recorded');
      onSaved();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Could not save.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="space-y-3"
      aria-label={produced ? 'Record production' : 'Record dispatch'}
    >
      <p className="text-muted-foreground text-sm">
        <T>
          {produced
            ? 'Only for work done without a job. Pieces Production records on its job task are counted here by themselves, so do not enter them again.'
            : 'Pieces sent to the customer. They come off finished goods.'}
        </T>
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-5">
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor={`${kind}-part`}>
            <T>{'Part number'}</T>
          </Label>
          <Input
            id={`${kind}-part`}
            required
            list={listId}
            autoComplete="off"
            placeholder="Type or pick a part"
            value={partNumber}
            onChange={(event) => setPartNumber(event.target.value)}
          />
          <datalist id={listId}>
            {parts.map((part) => (
              <option key={part.partNumber} value={part.partNumber}>
                {part.partName}
              </option>
            ))}
          </datalist>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${kind}-date`}>
            <T>{'Date'}</T>
          </Label>
          <Input
            id={`${kind}-date`}
            type="date"
            required
            max={today}
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${kind}-qty`}>
            <T>{produced ? 'Pieces made' : 'Pieces sent'}</T>
          </Label>
          <Input
            id={`${kind}-qty`}
            required
            inputMode="numeric"
            placeholder="0"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value.replace(/\D/g, ''))}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${kind}-ref`}>
            <T>{produced ? 'Shift (optional)' : 'DC number (optional)'}</T>
          </Label>
          <Input
            id={`${kind}-ref`}
            maxLength={60}
            value={reference}
            onChange={(e) => setReference(e.target.value)}
          />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${kind}-note`}>
          <T>{'Note (optional)'}</T>
        </Label>
        <Input
          id={`${kind}-note`}
          maxLength={300}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>
      {error ? (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : null}
      <div className="flex gap-2">
        <Button type="submit" disabled={saving}>
          {saving ? <Loader2 className="size-4 animate-spin" /> : null}
          <T>{produced ? 'Save production' : 'Save dispatch'}</T>
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          <T>{'Cancel'}</T>
        </Button>
      </div>
    </form>
  );
}

function EntryList({
  entries,
  currentUserId,
  removeAny,
  onRemoved,
}: {
  entries: StockEntryRow[];
  currentUserId: string;
  removeAny: boolean;
  onRemoved: () => void;
}) {
  const [removing, setRemoving] = useState<string | null>(null);

  async function remove(entry: StockEntryRow) {
    if (
      !window.confirm(
        `Remove ${entry.quantity} pcs ${entry.kind === 'PRODUCED' ? 'produced' : 'dispatched'} on ${day(entry.date)}?`,
      )
    )
      return;
    setRemoving(entry.id);
    try {
      await apiFetch(`/api/stock/movements/${entry.id}`, { method: 'DELETE' });
      toast.success('Line removed');
      onRemoved();
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : 'Could not remove the line.');
    } finally {
      setRemoving(null);
    }
  }

  if (entries.length === 0) {
    return (
      <p className="text-muted-foreground p-4 text-sm">
        <T>{'Nothing produced or dispatched has been entered in this period.'}</T>
      </p>
    );
  }
  return (
    <ul className="divide-border divide-y text-sm">
      {entries.map((entry) => (
        <li key={entry.id} className="flex items-center gap-3 px-4 py-2">
          {entry.kind === 'PRODUCED' ? (
            <Factory className="text-ok size-4 shrink-0" />
          ) : (
            <Truck className="text-action size-4 shrink-0" />
          )}
          <div className="min-w-0 flex-1">
            <p>
              <span className="font-medium">
                {entry.kind === 'PRODUCED' ? 'Produced' : 'Dispatched'} {n(entry.quantity)} pcs
              </span>
              {entry.rejected ? (
                <span className="text-late"> · rejected {n(entry.rejected)}</span>
              ) : null}
              {' · '}
              {entry.partName ? `${entry.partName} (${entry.partNumber})` : entry.partNumber}
              {entry.reference ? ` · ${entry.reference}` : ''}
              {entry.note ? <span className="text-muted-foreground"> · {entry.note}</span> : null}
            </p>
            <p className="text-muted-foreground text-xs">
              {day(entry.date)} · {entry.recordedBy.name}
              {entry.jobCode ? ` · from job ${entry.jobCode}` : ''}
            </p>
          </div>
          {!entry.jobCode && (removeAny || entry.recordedBy.id === currentUserId) ? (
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="Remove line"
              disabled={removing === entry.id}
              onClick={() => void remove(entry)}
            >
              {removing === entry.id ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Trash2 className="size-4" />
              )}
            </Button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

export function StockScreen({
  today,
  monthStart,
  parts,
  currentUserId,
  permissions,
}: {
  today: string;
  monthStart: string;
  parts: KnownPart[];
  currentUserId: string;
  permissions: StockPermissions;
}) {
  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(today);
  const [ledger, setLedger] = useState<StockLedger | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<StockPart | 'new' | null>(null);
  const [recording, setRecording] = useState<'PRODUCED' | 'DISPATCHED' | null>(null);
  const [downloading, setDownloading] = useState<'xlsx' | 'pdf' | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const { data } = await apiFetch<{ data: StockLedger }>(`/api/stock?from=${from}&to=${to}`);
      setLedger(data);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Could not load the stock.');
    }
  }, [from, to]);

  useEffect(() => {
    void load();
  }, [load]);

  async function download(format: 'xlsx' | 'pdf') {
    setDownloading(format);
    try {
      await downloadFile(`/api/stock?from=${from}&to=${to}&format=${format}`);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Could not download the file.');
    } finally {
      setDownloading(null);
    }
  }

  const toggle = (key: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="stock-from">
            <T>{'From'}</T>
          </Label>
          <Input
            id="stock-from"
            type="date"
            value={from}
            max={to}
            onChange={(e) => e.target.value && setFrom(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="stock-to">
            <T>{'To'}</T>
          </Label>
          <Input
            id="stock-to"
            type="date"
            value={to}
            min={from}
            max={today}
            onChange={(e) => e.target.value && setTo(e.target.value)}
          />
        </div>
        <Button variant="outline" onClick={() => void download('xlsx')} disabled={!!downloading}>
          {downloading === 'xlsx' ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Download className="size-4" />
          )}
          <T>{'Excel'}</T>
        </Button>
        <Button variant="outline" onClick={() => void download('pdf')} disabled={!!downloading}>
          {downloading === 'pdf' ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Download className="size-4" />
          )}
          <T>{'PDF'}</T>
        </Button>
        {permissions.recordProduced ? (
          <Button onClick={() => setRecording('PRODUCED')}>
            <Factory className="size-4" />
            <T>{'Record production'}</T>
          </Button>
        ) : null}
        {permissions.recordDispatch ? (
          <Button onClick={() => setRecording('DISPATCHED')}>
            <Truck className="size-4" />
            <T>{'Record dispatch'}</T>
          </Button>
        ) : null}
        {permissions.setOpening ? (
          <Button variant="secondary" onClick={() => setEditing('new')}>
            <PackagePlus className="size-4" />
            <T>{'Enter opening stock'}</T>
          </Button>
        ) : null}
      </div>

      {recording ? (
        <Panel
          title={<T>{recording === 'PRODUCED' ? 'Record production' : 'Record dispatch'}</T>}
          bodyClassName="p-4"
        >
          <MovementForm
            key={recording}
            kind={recording}
            today={today}
            parts={parts}
            onCancel={() => setRecording(null)}
            onSaved={() => {
              setRecording(null);
              void load();
            }}
          />
        </Panel>
      ) : null}

      {editing ? (
        <Panel title={<T>{'Opening stock'}</T>} bodyClassName="p-4">
          <OpeningForm
            key={editing === 'new' ? 'new' : editing.key}
            today={today}
            initial={editing === 'new' ? null : editing}
            onCancel={() => setEditing(null)}
            onSaved={() => {
              setEditing(null);
              void load();
            }}
          />
        </Panel>
      ) : null}

      {error ? (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : null}

      {!ledger ? (
        <Skeleton className="h-48 w-full" />
      ) : (
        <Panel
          title={<T>{'Stock by part'}</T>}
          description={
            <T>
              {from === to
                ? `On ${day(from)}. Click a part for its day-by-day movement.`
                : `${day(from)} to ${day(to)}. Click a part for its day-by-day movement.`}
            </T>
          }
          bodyClassName="p-0 overflow-x-auto"
        >
          {ledger.parts.length === 0 ? (
            <p className="text-muted-foreground p-4 text-sm">
              <T>
                {'No stock or movement in this period. Enter an opening stock to start a part.'}
              </T>
            </p>
          ) : (
            <table className="w-full min-w-[860px] text-sm">
              <thead className="bg-muted/50 text-muted-foreground text-left text-xs">
                <tr>
                  <th className="px-3 py-2 font-medium">
                    <T>{'Part'}</T>
                  </th>
                  <th className="px-3 py-2 text-right font-medium">
                    <T>{'Opening RM'}</T>
                  </th>
                  <th className="px-3 py-2 text-right font-medium">
                    <T>{'RM received'}</T>
                  </th>
                  <th className="px-3 py-2 text-right font-medium">
                    <T>{'Produced'}</T>
                  </th>
                  <th className="px-3 py-2 text-right font-medium">
                    <T>{'Rejected'}</T>
                  </th>
                  <th className="px-3 py-2 text-right font-medium">
                    <T>{'RM balance'}</T>
                  </th>
                  <th className="px-3 py-2 text-right font-medium">
                    <T>{'Opening FG'}</T>
                  </th>
                  <th className="px-3 py-2 text-right font-medium">
                    <T>{'Dispatched'}</T>
                  </th>
                  <th className="px-3 py-2 text-right font-medium">
                    <T>{'FG balance'}</T>
                  </th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-border divide-y">
                {ledger.parts.map((part) => (
                  <Fragment key={part.key}>
                    <tr
                      className="hover:bg-muted/30 cursor-pointer"
                      onClick={() => toggle(part.key)}
                    >
                      <td className="px-3 py-2">
                        <span className="flex items-start gap-1.5">
                          {open.has(part.key) ? (
                            <ChevronDown className="mt-0.5 size-4 shrink-0" />
                          ) : (
                            <ChevronRight className="mt-0.5 size-4 shrink-0" />
                          )}
                          <span>
                            <span className="font-medium">{part.partName}</span>
                            <span className="text-muted-foreground block text-xs">
                              {part.partNumber ?? 'No part number'}
                              {part.jobCodes.length ? ` · ${part.jobCodes.join(', ')}` : ''}
                              {part.openingSet
                                ? ` · opening set ${day(part.openingSet.asOfDate)}`
                                : ' · no opening entered'}
                            </span>
                          </span>
                        </span>
                      </td>
                      <Num value={part.opening.rm} tone="text-muted-foreground" />
                      <Num value={part.rmReceived} />
                      <Num value={part.produced} tone="text-ok" />
                      <Num value={part.rejected} tone="text-late" />
                      <Num value={part.closing.rm} tone="font-semibold" />
                      <Num value={part.opening.fg} tone="text-muted-foreground" />
                      <Num value={part.dispatched} />
                      <Num value={part.closing.fg} tone="font-semibold" />
                      <td className="px-3 py-2 text-right">
                        {part.partNumber && permissions.setOpening ? (
                          <Button
                            size="xs"
                            variant="ghost"
                            onClick={(event) => {
                              event.stopPropagation();
                              setEditing(part);
                            }}
                          >
                            <T>{'Opening'}</T>
                          </Button>
                        ) : null}
                      </td>
                    </tr>
                    {open.has(part.key) ? (
                      <tr className="bg-muted/20">
                        <td colSpan={10} className="px-3 py-2">
                          {part.days.length === 0 ? (
                            <p className="text-muted-foreground text-xs">
                              <T>{'No movement in this period.'}</T>
                            </p>
                          ) : (
                            <table className="w-full text-xs">
                              <thead className="text-muted-foreground text-left">
                                <tr>
                                  <th className="px-3 py-1 font-medium">
                                    <T>{'Date'}</T>
                                  </th>
                                  <th className="px-3 py-1 text-right font-medium">
                                    <T>{'RM received'}</T>
                                  </th>
                                  <th className="px-3 py-1 text-right font-medium">
                                    <T>{'Produced'}</T>
                                  </th>
                                  <th className="px-3 py-1 text-right font-medium">
                                    <T>{'Rejected'}</T>
                                  </th>
                                  <th className="px-3 py-1 text-right font-medium">
                                    <T>{'Dispatched'}</T>
                                  </th>
                                  <th className="px-3 py-1 text-right font-medium">
                                    <T>{'RM balance'}</T>
                                  </th>
                                  <th className="px-3 py-1 text-right font-medium">
                                    <T>{'FG balance'}</T>
                                  </th>
                                </tr>
                              </thead>
                              <tbody>
                                {part.days.map((d) => (
                                  <tr key={d.date}>
                                    <td className="px-3 py-1">{day(d.date)}</td>
                                    <Num value={d.rmReceived} />
                                    <Num value={d.produced} tone="text-ok" />
                                    <Num value={d.rejected} tone="text-late" />
                                    <Num value={d.dispatched} />
                                    <Num value={d.rmBalance} tone="font-semibold" />
                                    <Num value={d.fgBalance} tone="font-semibold" />
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                ))}
                <tr className="bg-muted/50 font-semibold">
                  <td className="px-3 py-2">
                    <T>{'Total'}</T>
                  </td>
                  <Num value={ledger.totals.opening.rm} />
                  <Num value={ledger.totals.rmReceived} />
                  <Num value={ledger.totals.produced} />
                  <Num value={ledger.totals.rejected} />
                  <Num value={ledger.totals.closing.rm} />
                  <Num value={ledger.totals.opening.fg} />
                  <Num value={ledger.totals.dispatched} />
                  <Num value={ledger.totals.closing.fg} />
                  <td />
                </tr>
              </tbody>
            </table>
          )}
        </Panel>
      )}
      {ledger ? (
        <Panel
          title={<T>{'Production and dispatch entries'}</T>}
          description={<T>{'What Production and dispatch typed in this period, newest first.'}</T>}
          bodyClassName="p-0"
        >
          <EntryList
            entries={ledger.entries}
            currentUserId={currentUserId}
            removeAny={permissions.removeAny}
            onRemoved={() => void load()}
          />
        </Panel>
      ) : null}

      <p className="text-muted-foreground text-xs">
        <T>
          {
            'A red figure means more was made or sent than was in hand: usually an opening stock that has not been entered yet, or a Store receipt not recorded.'
          }
        </T>
      </p>
    </div>
  );
}
