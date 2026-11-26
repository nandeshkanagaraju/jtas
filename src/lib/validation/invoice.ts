import { z } from 'zod';

/** "1250.5" or 1250.5 → 125050 paise; at most two decimals. */
const rupeesToPaise = z
  .union([z.string(), z.number()])
  .transform((value) => String(value).trim().replace(/,/g, ''))
  .refine((value) => /^\d+(\.\d{1,2})?$/.test(value), {
    message: 'Enter the rate in rupees, with at most two decimals.',
  })
  .transform((value) => Math.round(Number(value) * 100))
  .refine((paise) => paise <= 100_000_000_00, { message: 'The rate is too large.' });

/** "18" → 1800 basis points; 0 to 100 with at most two decimals. */
const percentToBasisPoints = z
  .union([z.string(), z.number()])
  .transform((value) => String(value).trim())
  .refine((value) => /^\d+(\.\d{1,2})?$/.test(value), {
    message: 'Enter GST as a percentage, for example 18.',
  })
  .transform((value) => Math.round(Number(value) * 100))
  .refine((bp) => bp <= 10_000, { message: 'GST cannot be more than 100%.' });

export const BILL_TYPES = ['SALES', 'PURCHASE'] as const;
export type BillTypeValue = (typeof BILL_TYPES)[number];

export const BILL_TYPE_LABEL: Record<BillTypeValue, string> = {
  SALES: 'Sales bill',
  PURCHASE: 'Purchase bill',
};

export const addInvoiceSchema = z
  .object({
    /** Sales: raised to the customer. Purchase: a supplier's bill booked against the job. */
    billType: z.enum(BILL_TYPES).default('SALES'),
    /** The supplier on a purchase bill (required); the customer on a sales bill (optional). */
    partyName: z
      .string()
      .trim()
      .max(120, 'Use at most 120 characters.')
      .optional()
      .transform((value) => (value ? value : undefined)),
    invoiceNumber: z
      .string()
      .trim()
      .min(1, 'Enter the bill number.')
      .max(40, 'Use at most 40 characters.'),
    /** The invoice date as printed, YYYY-MM-DD, read in IST. */
    invoiceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter the bill date.'),
    quantity: z.coerce
      .number({ invalid_type_error: 'Enter the quantity as a number.' })
      .int('Enter the quantity as a whole number.')
      .min(1, 'Enter at least one piece.')
      .max(1_000_000, 'The quantity is too large.'),
    rate: rupeesToPaise,
    gstPercent: percentToBasisPoints,
    note: z
      .string()
      .trim()
      .max(500, 'Use at most 500 characters.')
      .optional()
      .transform((value) => (value ? value : undefined)),
  })
  .superRefine((input, ctx) => {
    if (input.billType === 'PURCHASE' && !input.partyName) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['partyName'],
        message: 'Enter the supplier name for a purchase bill.',
      });
    }
  });

export type AddInvoiceInput = z.infer<typeof addInvoiceSchema>;
