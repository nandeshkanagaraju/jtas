'use client';

import { T } from '@/lib/i18n/provider';

import { ArrowDownToLine, ArrowUpFromLine, Loader2, Send } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from '@/lib/i18n/toast';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError, apiFetch, apiPost } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { formatIST, IST_DATE_PATTERN, istDateKey } from '@/lib/utils/time';
import { addStoreEntrySchema } from '@/lib/validation/store';

export interface StoreEntryDto {
  id: string;
  direction: 'INWARD' | 'OUTWARD';
  documentType: 'PR' | 'PO';
  documentNumber: string | null;
  supplierName: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  material: string | null;
  quantity: number | null;
  note: string | null;
  recordedBy: { id: string; name: string };
  createdAt: string;
}

function Choice<V extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: V;
  options: Array<{ value: V; label: string; icon?: React.ReactNode }>;
  onChange: (value: V) => void;
}) {
  return (
    <div className="space-y-1.5">
      <p className="text-sm font-medium">
        <T>{label}</T>
      </p>
      <div role="radiogroup" aria-label={label} className="grid grid-cols-2 gap-2">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={value === option.value}
            onClick={() => onChange(option.value)}
            className={cn(
              'flex min-h-11 items-center justify-center gap-2 rounded-md border px-3 text-sm font-medium',
              value === option.value
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border bg-card hover:bg-muted',
            )}
          >
            {option.icon}
            <T>{option.label}</T>
          </button>
        ))}
      </div>
    </div>
  );
}

const EMPTY = {
  documentNumber: '',
  supplierName: '',
  invoiceNumber: '',
  invoiceDate: '',
  material: '',
  quantity: '',
  note: '',
};

/**
 * The store register on a Store task: material in and out, typed in instead
 * of attaching the supplier's PDF. Each line goes to Production and Planning.
 */
export function StoreRegisterPanel({
  subtaskId,
  canRecord,
}: {
  subtaskId: string;
  canRecord: boolean;
}) {
  const [entries, setEntries] = useState<StoreEntryDto[] | null>(null);
  const [direction, setDirection] = useState<'INWARD' | 'OUTWARD'>('INWARD');
  const [documentType, setDocumentType] = useState<'PR' | 'PO'>('PO');
  const [form, setForm] = useState(() => ({ ...EMPTY, invoiceDate: istDateKey(new Date()) }));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let live = true;
    apiFetch<{ data: StoreEntryDto[] }>(`/api/subtasks/${subtaskId}/store-entries`)
      .then((result) => live && setEntries(result.data))
      .catch(() => live && setEntries([]));
    return () => {
      live = false;
    };
  }, [subtaskId]);

  const set = (key: keyof typeof EMPTY) => (event: React.ChangeEvent<HTMLInputElement>) =>
    setForm((current) => ({ ...current, [key]: event.target.value }));

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const parsed = addStoreEntrySchema.safeParse({ direction, documentType, ...form });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Check the entry.');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const { data } = await apiPost<{ data: StoreEntryDto }>(
        `/api/subtasks/${subtaskId}/store-entries`,
        parsed.data,
      );
      setEntries((current) => [data, ...(current ?? [])]);
      setForm({ ...EMPTY, invoiceDate: istDateKey(new Date()) });
      toast.success('Recorded and sent to Production and Planning');
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Could not record the entry.');
    } finally {
      setSaving(false);
    }
  }

  if (!entries) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

  const inward = direction === 'INWARD';

  return (
    <div className="space-y-4">
      {canRecord ? (
        <form onSubmit={submit} className="space-y-3" aria-label="Record store entry">
          <div className="grid gap-3 sm:grid-cols-2">
            <Choice
              label="Movement"
              value={direction}
              onChange={setDirection}
              options={[
                {
                  value: 'INWARD',
                  label: 'Material in',
                  icon: <ArrowDownToLine className="size-4" aria-hidden />,
                },
                {
                  value: 'OUTWARD',
                  label: 'Material out',
                  icon: <ArrowUpFromLine className="size-4" aria-hidden />,
                },
              ]}
            />
            <Choice
              label="Against"
              value={documentType}
              onChange={setDocumentType}
              options={[
                { value: 'PR', label: 'PR' },
                { value: 'PO', label: 'PO' },
              ]}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor={`store-doc-${subtaskId}`}>
                {documentType} <T>{'number (optional)'}</T>
              </Label>
              <Input
                id={`store-doc-${subtaskId}`}
                maxLength={40}
                value={form.documentNumber}
                onChange={set('documentNumber')}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`store-supplier-${subtaskId}`}>
                <T>{inward ? 'Supplier name' : 'Supplier name (optional)'}</T>
              </Label>
              <Input
                id={`store-supplier-${subtaskId}`}
                maxLength={120}
                value={form.supplierName}
                onChange={set('supplierName')}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`store-invoice-${subtaskId}`}>
                <T>{inward ? 'Invoice number' : 'Invoice number (optional)'}</T>
              </Label>
              <Input
                id={`store-invoice-${subtaskId}`}
                maxLength={40}
                value={form.invoiceNumber}
                onChange={set('invoiceNumber')}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`store-date-${subtaskId}`}>
                <T>{inward ? 'Invoice date' : 'Date (optional)'}</T>
              </Label>
              <Input
                id={`store-date-${subtaskId}`}
                type="date"
                value={form.invoiceDate}
                onChange={set('invoiceDate')}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`store-material-${subtaskId}`}>
                <T>{'Material (optional)'}</T>
              </Label>
              <Input
                id={`store-material-${subtaskId}`}
                maxLength={200}
                placeholder="e.g. EN8 bright bar Ø45"
                value={form.material}
                onChange={set('material')}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`store-qty-${subtaskId}`}>
                <T>{'Quantity (optional)'}</T>
              </Label>
              <Input
                id={`store-qty-${subtaskId}`}
                inputMode="numeric"
                pattern="[0-9]*"
                value={form.quantity}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    quantity: event.target.value.replace(/\D/g, ''),
                  }))
                }
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`store-note-${subtaskId}`}>
              <T>{'Note (optional)'}</T>
            </Label>
            <Input
              id={`store-note-${subtaskId}`}
              maxLength={500}
              value={form.note}
              onChange={set('note')}
            />
          </div>
          {error ? (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          ) : null}
          <Button type="submit" disabled={saving} className="min-h-11">
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
            <T>{'Record and send'}</T>
          </Button>
          <p className="text-muted-foreground text-xs">
            <T>{'Production and Planning are told as soon as you record it.'}</T>
          </p>
        </form>
      ) : null}

      <StoreEntryList entries={entries} />
    </div>
  );
}

/** The register lines, newest first. Also used on the job page. */
export function StoreEntryList({ entries }: { entries: StoreEntryDto[] }) {
  if (entries.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        <T>{'Nothing recorded in the store register yet.'}</T>
      </p>
    );
  }
  return (
    <ul className="divide-border divide-y text-sm" aria-label="Store register">
      {entries.map((entry) => (
        <li key={entry.id} className="py-2">
          <p className="font-medium">
            <span className={entry.direction === 'INWARD' ? 'text-ok' : 'text-foreground'}>
              <T>{entry.direction === 'INWARD' ? 'In' : 'Out'}</T>
            </span>
            {' · '}
            {entry.documentType}
            {entry.documentNumber ? ` ${entry.documentNumber}` : ''}
            {entry.supplierName ? ` · ${entry.supplierName}` : ''}
            {entry.quantity !== null ? ` · ${entry.quantity}` : ''}
          </p>
          {entry.invoiceNumber || entry.material || entry.note ? (
            <p className="text-muted-foreground">
              {[
                entry.invoiceNumber
                  ? `Invoice ${entry.invoiceNumber}${entry.invoiceDate ? ` · ${formatIST(new Date(entry.invoiceDate), IST_DATE_PATTERN)}` : ''}`
                  : null,
                entry.material,
                entry.note,
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
          ) : null}
          <p className="text-muted-foreground text-xs">
            {entry.recordedBy.name} · {formatIST(new Date(entry.createdAt))}
          </p>
        </li>
      ))}
    </ul>
  );
}
