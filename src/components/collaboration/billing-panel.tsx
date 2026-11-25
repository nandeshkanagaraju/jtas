'use client';

import { T } from '@/lib/i18n/provider';

import { Loader2, ReceiptIndianRupee } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from '@/lib/i18n/toast';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError, apiFetch, apiPost } from '@/lib/api/client';
import { formatGstPercent, formatRupees, invoiceAmounts } from '@/lib/domain/money';
import { addInvoiceSchema } from '@/lib/validation/invoice';
import { formatIST, IST_DATE_PATTERN, istDateKey } from '@/lib/utils/time';

interface InvoiceDto {
  id: string;
  invoiceNumber: string;
  invoiceDate: string;
  quantity: number;
  ratePaise: number;
  gstBasisPoints: number;
  note: string | null;
  taxablePaise: number;
  gstPaise: number;
  totalPaise: number;
  createdBy: { id: string; name: string };
}

interface BillingDto {
  jobQuantity: number | null;
  inspection: { department: string; accepted: number; rejected: number; reports: number } | null;
  billableBase: number | null;
  invoicedQuantity: number;
  remaining: number | null;
  totals: { taxablePaise: number; gstPaise: number; totalPaise: number };
  invoices: InvoiceDto[];
}

function Figure({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="border-border bg-card rounded-lg border px-3 py-2">
      <p className="text-muted-foreground text-xs">
        <T>{label}</T>
      </p>
      <p className="font-mono text-lg font-semibold tabular-nums">{value}</p>
      {hint ? <p className="text-muted-foreground text-xs">{hint}</p> : null}
    </div>
  );
}

/**
 * Invoices on a job, for Accounts, the MD and the Deputy. The billable figure
 * is what final inspection accepted, less what is already invoiced.
 */
export function BillingPanel({ jobId }: { jobId: string }) {
  const [billing, setBilling] = useState<BillingDto | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [form, setForm] = useState({
    invoiceNumber: '',
    invoiceDate: istDateKey(new Date()),
    quantity: '',
    rate: '',
    gstPercent: '18',
    note: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function load() {
    try {
      const { data } = await apiFetch<{ data: BillingDto }>(`/api/jobs/${jobId}/invoices`);
      setBilling(data);
      setForm((current) => ({
        ...current,
        quantity: current.quantity || (data.remaining ? String(data.remaining) : ''),
      }));
    } catch (cause) {
      setLoadError(cause instanceof ApiError ? cause.message : 'Could not load invoices.');
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  const preview = useMemo(() => {
    const parsed = addInvoiceSchema.safeParse({
      ...form,
      invoiceNumber: form.invoiceNumber || 'x',
    });
    if (!parsed.success) return null;
    return invoiceAmounts(parsed.data.quantity, parsed.data.rate, parsed.data.gstPercent);
  }, [form]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const parsed = addInvoiceSchema.safeParse(form);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Check the invoice details.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await apiPost(`/api/jobs/${jobId}/invoices`, {
        ...form,
        note: form.note || undefined,
      });
      toast.success(`Invoice ${parsed.data.invoiceNumber} recorded`);
      setForm((current) => ({ ...current, invoiceNumber: '', quantity: '', note: '' }));
      await load();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Could not record the invoice.');
    } finally {
      setSaving(false);
    }
  }

  if (loadError) return <p className="text-destructive text-sm">{loadError}</p>;
  if (!billing) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  const { inspection, billableBase, invoicedQuantity, remaining, totals, invoices } = billing;
  const estimated = !(inspection && inspection.reports > 0);
  const quantity = Number(form.quantity) || 0;
  const overBilling = remaining !== null && quantity > remaining;
  const set = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement>) =>
    setForm((current) => ({ ...current, [key]: event.target.value }));

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Figure
          label="Billable"
          value={billableBase === null ? '—' : String(billableBase)}
          hint={
            estimated
              ? billableBase === null
                ? 'No quantity or counts yet'
                : 'Job quantity; no inspection counts yet'
              : `Accepted at ${inspection?.department}${inspection?.rejected ? ` · ${inspection.rejected} rejected` : ''}`
          }
        />
        <Figure label="Invoiced" value={String(invoicedQuantity)} />
        <Figure label="Still to invoice" value={remaining === null ? '—' : String(remaining)} />
        <Figure label="Invoiced value" value={formatRupees(totals.totalPaise)} hint="incl. GST" />
      </div>

      <form onSubmit={submit} className="space-y-3" aria-label="Record invoice">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor={`inv-no-${jobId}`}>
              <T>{'Invoice number'}</T>
            </Label>
            <Input
              id={`inv-no-${jobId}`}
              value={form.invoiceNumber}
              onChange={set('invoiceNumber')}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`inv-date-${jobId}`}>
              <T>{'Invoice date'}</T>
            </Label>
            <Input
              id={`inv-date-${jobId}`}
              type="date"
              value={form.invoiceDate}
              onChange={set('invoiceDate')}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`inv-qty-${jobId}`}>
              <T>{'Quantity'}</T>
            </Label>
            <Input
              id={`inv-qty-${jobId}`}
              inputMode="numeric"
              value={form.quantity}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  quantity: event.target.value.replace(/\D/g, ''),
                }))
              }
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`inv-rate-${jobId}`}>
              <T>{'Rate per piece (₹)'}</T>
            </Label>
            <Input
              id={`inv-rate-${jobId}`}
              inputMode="decimal"
              placeholder="0.00"
              value={form.rate}
              onChange={set('rate')}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`inv-gst-${jobId}`}>
              <T>{'GST %'}</T>
            </Label>
            <Input
              id={`inv-gst-${jobId}`}
              inputMode="decimal"
              value={form.gstPercent}
              onChange={set('gstPercent')}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`inv-note-${jobId}`}>
              <T>{'Note (optional)'}</T>
            </Label>
            <Input
              id={`inv-note-${jobId}`}
              maxLength={500}
              value={form.note}
              onChange={set('note')}
            />
          </div>
        </div>

        {preview ? (
          <p className="text-muted-foreground text-sm">
            <T>{'Taxable'}</T> {formatRupees(preview.taxablePaise)} · <T>{'GST'}</T>{' '}
            {formatRupees(preview.gstPaise)} ·{' '}
            <span className="text-foreground font-semibold">
              <T>{'Total'}</T> {formatRupees(preview.totalPaise)}
            </span>
          </p>
        ) : null}
        {overBilling ? (
          <p className="text-risk text-sm">
            <T>{'This is more than is still to invoice'}</T> ({remaining}).{' '}
            <T>{'Check the inspection counts before raising it.'}</T>
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        ) : null}
        <Button type="submit" disabled={saving}>
          {saving ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <ReceiptIndianRupee className="size-4" />
          )}
          <T>{'Record invoice'}</T>
        </Button>
      </form>

      {invoices.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm" aria-label="Invoices on this job">
            <thead className="text-muted-foreground text-left text-xs">
              <tr>
                <th className="py-2 pr-3 font-medium">
                  <T>{'Invoice'}</T>
                </th>
                <th className="py-2 pr-3 font-medium">
                  <T>{'Date'}</T>
                </th>
                <th className="py-2 pr-3 text-right font-medium">
                  <T>{'Qty'}</T>
                </th>
                <th className="py-2 pr-3 text-right font-medium">
                  <T>{'Rate'}</T>
                </th>
                <th className="py-2 pr-3 text-right font-medium">
                  <T>{'GST'}</T>
                </th>
                <th className="py-2 text-right font-medium">
                  <T>{'Total'}</T>
                </th>
              </tr>
            </thead>
            <tbody className="divide-border divide-y">
              {invoices.map((invoice) => (
                <tr key={invoice.id}>
                  <td className="py-2 pr-3">
                    <span className="font-medium">{invoice.invoiceNumber}</span>
                    <span className="text-muted-foreground block text-xs">
                      {invoice.createdBy.name}
                      {invoice.note ? ` · ${invoice.note}` : ''}
                    </span>
                  </td>
                  <td className="py-2 pr-3 whitespace-nowrap">
                    {formatIST(new Date(invoice.invoiceDate), IST_DATE_PATTERN)}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">{invoice.quantity}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">
                    {formatRupees(invoice.ratePaise)}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">
                    {formatGstPercent(invoice.gstBasisPoints)}%
                  </td>
                  <td className="py-2 text-right font-medium tabular-nums">
                    {formatRupees(invoice.totalPaise)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-muted-foreground text-sm">
          <T>{'No invoices recorded on this job yet.'}</T>
        </p>
      )}
    </div>
  );
}
