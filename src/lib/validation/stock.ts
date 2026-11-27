import { z } from 'zod';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const quantity = z.coerce
  .number({ message: 'Enter a whole number.' })
  .int('Enter a whole number.')
  .min(0, 'Stock cannot be negative.')
  .max(10_000_000, 'That is more than the shop could hold.');

export const setStockOpeningSchema = z.object({
  partNumber: z.string().trim().min(1, 'Enter the part number.').max(80),
  partName: z.string().trim().max(120).optional(),
  asOfDate: z.string().regex(DATE, 'Enter the date.'),
  rmQty: quantity,
  fgQty: quantity,
});
export type SetStockOpeningInput = z.infer<typeof setStockOpeningSchema>;

export const recordStockMovementSchema = z.object({
  kind: z.enum(['PRODUCED', 'DISPATCHED']),
  partNumber: z.string().trim().min(1, 'Choose the part.').max(80),
  partName: z.string().trim().max(120).optional(),
  date: z.string().regex(DATE, 'Enter the date.'),
  quantity: z.coerce
    .number({ message: 'Enter a whole number.' })
    .int('Enter a whole number.')
    .min(1, 'Enter at least 1 piece.')
    .max(10_000_000, 'That is more than the shop could make.'),
  reference: z.string().trim().max(60).optional(),
  note: z.string().trim().max(300).optional(),
});
export type RecordStockMovementInput = z.infer<typeof recordStockMovementSchema>;

/** `?from=&to=` for the ledger; at most a year so a careless link stays cheap. */
export const stockRangeSchema = z
  .object({
    from: z.string().regex(DATE, 'Choose the start date.'),
    to: z.string().regex(DATE, 'Choose the end date.'),
    format: z.enum(['json', 'xlsx', 'pdf']).default('json'),
  })
  .refine((range) => range.from <= range.to, { message: 'The start date is after the end date.' })
  .refine((range) => Date.parse(range.to) - Date.parse(range.from) <= 366 * 24 * 60 * 60_000, {
    message: 'Choose a range of a year or less.',
  });
