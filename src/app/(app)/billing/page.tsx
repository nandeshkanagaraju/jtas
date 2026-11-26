import { T } from '@/lib/i18n/provider';
import type { Metadata } from 'next';
import Link from 'next/link';
import { forbidden } from 'next/navigation';

import { BillTypeBadge } from '@/components/collaboration/billing-panel';
import { PageHeader } from '@/components/shared/page-header';
import { Panel } from '@/components/shared/panel';
import { requireActiveSession } from '@/lib/auth/session';
import { formatRupees } from '@/lib/domain/money';
import { billingDashboard, canManageBilling } from '@/lib/services/billing-service';
import { formatIST, IST_DATE_PATTERN } from '@/lib/utils/time';

export const metadata: Metadata = { title: 'Billing' };
export const dynamic = 'force-dynamic';

const bills = (count: number) => `${count} bill${count === 1 ? '' : 's'}`;

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="border-border bg-card rounded-xl border px-4 py-3">
      <p className="text-muted-foreground text-xs">
        <T>{label}</T>
      </p>
      <p className="mt-1 font-mono text-2xl font-semibold tabular-nums">{value}</p>
      {hint ? <p className="text-muted-foreground mt-0.5 text-xs">{hint}</p> : null}
    </div>
  );
}

/**
 * The Accounts view: what is dispatched and still to invoice, and what has
 * been invoiced. Accounts, the MD and the Deputy only.
 */
export default async function BillingPage() {
  const session = await requireActiveSession();
  if (!(await canManageBilling(session))) forbidden();

  const { ready, recent, month, purchaseMonth, invoicedJobs } = await billingDashboard();
  const piecesToInvoice = ready.reduce((sum, row) => sum + (row.remaining ?? 0), 0);

  return (
    <div className="w-full space-y-5">
      <PageHeader
        eyebrow={<T>{'Accounts'}</T>}
        title={<T>{'Billing'}</T>}
        lead={<T>{'Jobs ready to invoice, and the sales and purchase bills booked this month.'}</T>}
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile
          label="Ready to invoice"
          value={String(ready.length)}
          hint={`${piecesToInvoice} pcs`}
        />
        <Tile
          label="Sales bills this month"
          value={formatRupees(month.totalPaise)}
          hint={`${bills(month.invoices)} · ${month.quantity} pcs · ${invoicedJobs} jobs · GST ${formatRupees(month.gstPaise)}`}
        />
        <Tile
          label="Purchase bills this month"
          value={formatRupees(purchaseMonth.totalPaise)}
          hint={`${bills(purchaseMonth.invoices)} · GST ${formatRupees(purchaseMonth.gstPaise)}`}
        />
        <Tile
          label="Net this month"
          value={formatRupees(month.totalPaise - purchaseMonth.totalPaise)}
          hint="Sales less purchases, incl. GST"
        />
      </div>

      <Panel
        title={<T>{'Ready to invoice'}</T>}
        count={ready.length}
        description={
          <T>
            {'Jobs Planning has sent for invoicing, or dispatched, with pieces not yet invoiced.'}
          </T>
        }
        flush
      >
        {ready.length === 0 ? (
          <p className="text-muted-foreground p-5 text-sm">
            <T>{'Nothing waiting. Every dispatched piece has been invoiced.'}</T>
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-muted-foreground text-left text-xs">
                <tr>
                  <th className="px-5 py-2.5 font-medium">
                    <T>{'Job'}</T>
                  </th>
                  <th className="px-3 py-2.5 text-right font-medium">
                    <T>{'Billable'}</T>
                  </th>
                  <th className="px-3 py-2.5 text-right font-medium">
                    <T>{'Invoiced'}</T>
                  </th>
                  <th className="px-3 py-2.5 text-right font-medium">
                    <T>{'To invoice'}</T>
                  </th>
                  <th className="px-3 py-2.5 font-medium">
                    <T>{'Based on'}</T>
                  </th>
                  <th className="px-5 py-2.5 font-medium">
                    <T>{'Planning intimation'}</T>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-border divide-y">
                {ready.map((row) => (
                  <tr key={row.jobId}>
                    <td className="px-5 py-3">
                      <Link
                        href={`/jobs/${row.jobId}`}
                        className="font-mono font-medium hover:underline"
                      >
                        {row.jobCode}
                      </Link>
                      <span className="text-muted-foreground block text-xs">{row.jobTitle}</span>
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums">{row.billableBase ?? '—'}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{row.invoicedQuantity}</td>
                    <td className="px-3 py-3 text-right font-semibold tabular-nums">
                      {row.remaining ?? '—'}
                    </td>
                    <td className="text-muted-foreground px-3 py-3 text-xs">
                      {row.estimated ? (
                        <T>{'Job quantity (no inspection counts)'}</T>
                      ) : (
                        <>
                          <T>{'Accepted at'}</T> {row.inspectionDepartment}
                        </>
                      )}
                      {row.dispatched ? null : (
                        <span className="block">
                          <T>
                            {row.status === 'COMPLETED' ? 'Job completed' : 'Not dispatched yet'}
                          </T>
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-xs">
                      {row.intimation ? (
                        <>
                          <span className="font-medium">
                            {formatIST(row.intimation.at, 'd MMM, h:mm a')}
                          </span>
                          {row.intimation.by ? (
                            <span className="text-muted-foreground"> · {row.intimation.by}</span>
                          ) : null}
                          {row.intimation.note ? (
                            <span className="text-muted-foreground block">
                              {row.intimation.note}
                            </span>
                          ) : null}
                        </>
                      ) : (
                        <span className="text-muted-foreground">
                          <T>{'Not sent'}</T>
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel title={<T>{'Recent bills'}</T>} count={recent.length} flush>
        {recent.length === 0 ? (
          <p className="text-muted-foreground p-5 text-sm">
            <T>{'No bills recorded yet.'}</T>
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-muted-foreground text-left text-xs">
                <tr>
                  <th className="px-5 py-2.5 font-medium">
                    <T>{'Bill'}</T>
                  </th>
                  <th className="px-3 py-2.5 font-medium">
                    <T>{'Supplier / customer'}</T>
                  </th>
                  <th className="px-3 py-2.5 font-medium">
                    <T>{'Job'}</T>
                  </th>
                  <th className="px-3 py-2.5 font-medium">
                    <T>{'Date'}</T>
                  </th>
                  <th className="px-3 py-2.5 text-right font-medium">
                    <T>{'Qty'}</T>
                  </th>
                  <th className="px-5 py-2.5 text-right font-medium">
                    <T>{'Total'}</T>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-border divide-y">
                {recent.map((invoice) => (
                  <tr key={invoice.id}>
                    <td className="px-5 py-3 whitespace-nowrap">
                      <BillTypeBadge type={invoice.billType} />{' '}
                      <span className="font-medium">{invoice.invoiceNumber}</span>
                    </td>
                    <td className="text-muted-foreground px-3 py-3">{invoice.partyName ?? '—'}</td>
                    <td className="px-3 py-3">
                      <Link href={`/jobs/${invoice.jobId}`} className="font-mono hover:underline">
                        {invoice.jobCode}
                      </Link>
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap">
                      {formatIST(invoice.invoiceDate, IST_DATE_PATTERN)}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums">{invoice.quantity}</td>
                    <td className="px-5 py-3 text-right font-semibold tabular-nums">
                      {formatRupees(invoice.totalPaise)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
