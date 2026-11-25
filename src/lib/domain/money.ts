/**
 * Invoice arithmetic in integer paise and GST basis points (1800 = 18%), so a
 * total never drifts by a paisa from floating-point error. Safe on the client.
 */
export interface InvoiceAmounts {
  taxablePaise: number;
  gstPaise: number;
  totalPaise: number;
}

export function invoiceAmounts(
  quantity: number,
  ratePaise: number,
  gstBasisPoints: number,
): InvoiceAmounts {
  const taxablePaise = quantity * ratePaise;
  // Round half up to the nearest paisa, as an invoice prints it.
  const gstPaise = Math.round((taxablePaise * gstBasisPoints) / 10_000);
  return { taxablePaise, gstPaise, totalPaise: taxablePaise + gstPaise };
}

const RUPEES = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** ₹1,23,456.78 — Indian digit grouping. */
export function formatRupees(paise: number): string {
  return RUPEES.format(paise / 100);
}

/** "18" for 1800, "12.5" for 1250. */
export function formatGstPercent(basisPoints: number): string {
  return String(basisPoints / 100);
}
