import { z } from 'zod';

/** Generous ceiling: no single report on a CNC job comes near a million parts. */
export const MATERIAL_QTY_MAX = 1_000_000;

const quantity = (label: string) =>
  z.coerce
    .number({ invalid_type_error: `Enter the ${label} quantity as a number.` })
    .int(`Enter the ${label} quantity as a whole number.`)
    .min(0, `The ${label} quantity cannot be negative.`)
    .max(MATERIAL_QTY_MAX, `The ${label} quantity is too large.`);

export const addMaterialCountSchema = z
  .object({
    acceptedQty: quantity('accepted'),
    rejectedQty: quantity('rejected'),
    note: z
      .string()
      .trim()
      .max(500, 'Use at most 500 characters.')
      .optional()
      .transform((value) => (value ? value : undefined)),
  })
  .refine((value) => value.acceptedQty + value.rejectedQty > 0, {
    message: 'Enter an accepted or a rejected quantity.',
    path: ['acceptedQty'],
  });

export type AddMaterialCountInput = z.infer<typeof addMaterialCountSchema>;
