import { z } from 'zod';

import { istDateTimeSchema } from './job';
import { MATERIAL_QTY_MAX } from './materials';

/** Production and Quality plan their task as up to 30 dated batches. */
export const MAX_BATCHES = 30;

export const planBatchesSchema = z.object({
  batches: z
    .array(
      z.object({
        quantity: z.coerce
          .number({ invalid_type_error: 'Enter the batch quantity as a number.' })
          .int('Enter the batch quantity as a whole number.')
          .min(1, 'Each batch needs at least one piece.')
          .max(MATERIAL_QTY_MAX, 'The batch quantity is too large.'),
        /** Naive IST wall-clock, like every other deadline. */
        deadline: istDateTimeSchema,
      }),
    )
    .min(1, 'Add at least one batch.')
    .max(MAX_BATCHES, `Use at most ${MAX_BATCHES} batches.`),
  /** Needed when a batch date falls after the job's own deadline. */
  deadlineOverrideReason: z.string().trim().min(5).max(500).optional(),
  /** Required when the MD or a job manager re-plans batches already set. */
  reason: z
    .string()
    .trim()
    .min(5, 'Give a short reason — it goes on the record.')
    .max(500)
    .optional(),
});

export type PlanBatchesInput = z.infer<typeof planBatchesSchema>;

export const closeBatchSchema = z
  .object({
    acceptedQty: z.coerce
      .number({ invalid_type_error: 'Enter the accepted quantity as a number.' })
      .int('Enter the accepted quantity as a whole number.')
      .min(0, 'The accepted quantity cannot be negative.')
      .max(MATERIAL_QTY_MAX),
    rejectedQty: z.coerce
      .number({ invalid_type_error: 'Enter the rejected quantity as a number.' })
      .int('Enter the rejected quantity as a whole number.')
      .min(0, 'The rejected quantity cannot be negative.')
      .max(MATERIAL_QTY_MAX),
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

export type CloseBatchInput = z.infer<typeof closeBatchSchema>;
