/**
 * Job shapes (architecture rule 4).
 *
 * Deadlines cross the wire as a **naive IST wall-clock string**
 * (`2026-10-15T16:30`), never as an instant. The browser may be in any
 * timezone; sending what the user actually typed and converting it once on the
 * server with `fromISTInput()` is the only arrangement where the deadline the
 * MD sees is the deadline the scheduler uses (architecture rule 1).
 */
import { z } from 'zod';

import { paginationSchema, searchSchema } from './common';

export const jobStatusSchema = z.enum([
  'DRAFT',
  'IN_PROGRESS',
  'AT_RISK',
  'DELAYED',
  'ON_HOLD',
  'COMPLETED',
  'CANCELLED',
]);
export type JobStatusValue = z.infer<typeof jobStatusSchema>;

export const prioritySchema = z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']);
export type PriorityValue = z.infer<typeof prioritySchema>;

/** `YYYY-MM-DDTHH:mm`, interpreted as Asia/Kolkata. */
export const istDateTimeSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, 'Choose a date and time.');

const titleSchema = z
  .string()
  .trim()
  .min(3, 'Give the job a title of at least 3 characters.')
  .max(200, 'Use at most 200 characters.');

const optionalText = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max, `Use at most ${max} characters.`)
    .optional()
    .or(z.literal('').transform(() => undefined))
    .describe(label);

export const createJobSchema = z.object({
  title: titleSchema,
  customerName: optionalText(200, 'customer'),
  partNumber: optionalText(100, 'part number'),
  drawingNumber: optionalText(100, 'drawing number'),
  quantity: z.coerce
    .number()
    .int('Quantity must be a whole number.')
    .positive('Quantity must be at least 1.')
    .max(1_000_000, 'That quantity looks wrong.')
    .optional(),
  priority: prioritySchema.default('NORMAL'),
  description: optionalText(5_000, 'description'),
  overallDeadline: istDateTimeSchema,
});

export type CreateJobInput = z.infer<typeof createJobSchema>;

/**
 * Editable fields.
 *
 * Which of them the server actually accepts depends on the job's status — a
 * published job only takes title, customer, priority and description (build
 * spec M3.1). The schema stays permissive so the service can give a precise
 * error naming the field and the reason, rather than a generic rejection.
 */
export const updateJobSchema = createJobSchema
  .partial()
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: 'Nothing to update.',
  });

export type UpdateJobInput = z.infer<typeof updateJobSchema>;

/** Hold and cancel both require a reason, which lands in the audit log. */
export const jobReasonSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(5, 'Give a short reason — it goes on the record.')
    .max(500, 'Use at most 500 characters.'),
});

export type JobReasonInput = z.infer<typeof jobReasonSchema>;

export const listJobsQuerySchema = paginationSchema.merge(searchSchema).extend({
  status: jobStatusSchema.optional(),
  priority: prioritySchema.optional(),
  /** Jobs with at least one subtask owned by this department. */
  departmentId: z.string().min(1).optional(),
  /** Overall-deadline range, as IST wall-clock dates. */
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a YYYY-MM-DD date.')
    .optional(),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a YYYY-MM-DD date.')
    .optional(),
  sort: z.enum(['overallDeadline', 'createdAt', 'jobCode', 'priority']).default('overallDeadline'),
  direction: z.enum(['asc', 'desc']).default('asc'),
  /**
   * Opaque cursor — the id of the last row of the previous page. Preferred over
   * `page` for deep lists, because an offset re-reads every skipped row and can
   * repeat or drop items when the set changes underneath it.
   */
  cursor: z.string().min(1).optional(),
});

export type ListJobsQuery = z.infer<typeof listJobsQuerySchema>;
