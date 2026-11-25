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

export const addInvoiceSchema = z.object({
  invoiceNumber: z
    .string()
    .trim()
    .min(1, 'Enter the invoice number.')
    .max(40, 'Use at most 40 characters.'),
  /** The invoice date as printed, YYYY-MM-DD, read in IST. */
  invoiceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter the invoice date.'),
  quantity: z.coerce
    .number({ invalid_type_error: 'Enter the invoiced quantity as a number.' })
    .int('Enter the invoiced quantity as a whole number.')
    .min(1, 'Invoice at least one piece.')
    .max(1_000_000, 'The quantity is too large.'),
  rate: rupeesToPaise,
  gstPercent: percentToBasisPoints,
  note: z
    .string()
    .trim()
    .max(500, 'Use at most 500 characters.')
    .optional()
    .transform((value) => (value ? value : undefined)),
});

export type AddInvoiceInput = z.infer<typeof addInvoiceSchema>;
