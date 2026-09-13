/**
 * Extension requests — FR-33, PDD improvement I-11.
 *
 * "Gives the honest member a legitimate path instead of silence." A member who
 * is going to miss a deadline has two options without this: say nothing, or
 * raise a problem that is not really a problem. Both corrupt the data the MD
 * relies on.
 */
import { z } from 'zod';

import { istDateTimeSchema } from './job';

/**
 * The reason minimum matches the problem-description minimum for the same
 * reason (FR-32): a request the MD cannot act on is not a request.
 */
export const EXTENSION_REASON_MIN = 20;

export const createExtensionRequestSchema = z.object({
  requestedDeadline: istDateTimeSchema,
  reason: z
    .string()
    .trim()
    .min(EXTENSION_REASON_MIN, `Explain in at least ${EXTENSION_REASON_MIN} characters.`)
    .max(1_000, 'Use at most 1000 characters.'),
});

export type CreateExtensionRequestInput = z.infer<typeof createExtensionRequestSchema>;

export const decideExtensionRequestSchema = z.object({
  decision: z.enum(['APPROVE', 'REJECT']),
  /** Shown to the member; required on a rejection so the answer is not bare. */
  note: z.string().trim().max(500).optional(),
});

export type DecideExtensionRequestInput = z.infer<typeof decideExtensionRequestSchema>;
