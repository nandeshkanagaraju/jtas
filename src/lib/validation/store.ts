import { z } from 'zod';

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Use at most ${max} characters.`)
    .optional()
    .transform((value) => (value ? value : undefined));

/**
 * One store register line, typed in instead of attaching the supplier's PDF.
 * Material received needs the supplier, invoice number and invoice date;
 * material issued out needs only what was issued.
 */
export const addStoreEntrySchema = z
  .object({
    direction: z.enum(['INWARD', 'OUTWARD'], {
      errorMap: () => ({ message: 'Choose material in or material out.' }),
    }),
    documentType: z.enum(['PR', 'PO'], { errorMap: () => ({ message: 'Choose PR or PO.' }) }),
    documentNumber: optionalText(40),
    supplierName: optionalText(120),
    invoiceNumber: optionalText(40),
    /** The invoice date as printed, YYYY-MM-DD. */
    invoiceDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter the invoice date.')
      .optional()
      .or(z.literal('').transform(() => undefined)),
    material: optionalText(200),
    quantity: z
      .union([z.coerce.number(), z.literal('')])
      .optional()
      .transform((value) => (value === '' || value === undefined ? undefined : value))
      .refine((value) => value === undefined || (Number.isInteger(value) && value >= 0), {
        message: 'Enter the quantity as a whole number.',
      })
      .refine((value) => value === undefined || value <= 10_000_000, {
        message: 'The quantity is too large.',
      }),
    note: optionalText(500),
  })
  .superRefine((value, ctx) => {
    if (value.direction !== 'INWARD') return;
    if (!value.supplierName) {
      ctx.addIssue({ code: 'custom', path: ['supplierName'], message: 'Enter the supplier name.' });
    }
    if (!value.invoiceNumber) {
      ctx.addIssue({
        code: 'custom',
        path: ['invoiceNumber'],
        message: 'Enter the invoice number.',
      });
    }
    if (!value.invoiceDate) {
      ctx.addIssue({ code: 'custom', path: ['invoiceDate'], message: 'Enter the invoice date.' });
    }
  });

export type AddStoreEntryInput = z.infer<typeof addStoreEntrySchema>;
