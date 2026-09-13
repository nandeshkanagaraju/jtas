/**
 * Subtask shapes (architecture rule 4).
 *
 * Deadlines cross the wire as naive IST wall-clock strings, exactly as job
 * deadlines do — see the note in `./job.ts`.
 */
import { z } from 'zod';

import { istDateTimeSchema } from './job';

export const subtaskStatusSchema = z.enum([
  'PENDING',
  'BLOCKED',
  'IN_PROGRESS',
  'PROBLEM',
  'AWAITING_APPROVAL',
  'COMPLETED',
  'ON_HOLD',
  'CANCELLED',
]);

export const subtaskActionSchema = z.enum([
  'START',
  'COMPLETE',
  'PROBLEM',
  'APPROVE',
  'REJECT',
  'RESOLVE_PROBLEM',
  'HOLD',
  'UNHOLD',
  'CANCEL',
]);

export type SubtaskActionValue = z.infer<typeof subtaskActionSchema>;

export const problemSeveritySchema = z.enum(['LOW', 'MEDIUM', 'HIGH', 'BLOCKER']);

const titleSchema = z
  .string()
  .trim()
  .min(3, 'Give the subtask a title of at least 3 characters.')
  .max(200, 'Use at most 200 characters.');

/**
 * 15 minutes to 30 days, in minutes. Stored per subtask (FR-21, I-09).
 *
 * Optional rather than defaulted to 360. A default here would resolve before
 * the service ever sees the request, so `reminder.default_lead_minutes` — the
 * setting an operator changes on /settings — could never take effect. Omitted
 * means "use the configured default"; a number means this subtask overrides it.
 */
const reminderLeadSchema = z.coerce
  .number()
  .int()
  .min(15, 'Give at least 15 minutes of warning.')
  .max(43_200, 'That is more than 30 days.')
  .optional();

/**
 * One subtask as the wizard and the API express it.
 *
 * `dependsOnKey` is a *client-side* reference to another row in the same batch,
 * used while nothing has an id yet; `dependsOnId` is the real foreign key. The
 * bulk-create resolves the first into the second.
 */
export const subtaskDraftSchema = z.object({
  /** Stable key for this row within a batch, so dependencies can be expressed. */
  key: z.string().min(1).optional(),
  departmentId: z.string().min(1, 'Choose a department.'),
  assigneeId: z.string().min(1, 'Choose who is responsible.'),
  title: titleSchema,
  description: z
    .string()
    .trim()
    .max(5_000)
    .optional()
    .or(z.literal('').transform(() => undefined)),
  deadline: istDateTimeSchema,
  reminderLeadMinutes: reminderLeadSchema,
  requiresApproval: z.boolean().default(false),
  dependsOnId: z.string().min(1).nullable().optional(),
  dependsOnKey: z.string().min(1).nullable().optional(),
});

export type SubtaskDraftInput = z.infer<typeof subtaskDraftSchema>;

/**
 * Overrides for the two rules that warn rather than block (build spec M4.2).
 *
 * A deadline after the job's own, or an assignee from another department, are
 * both sometimes correct — so they are refused only until the MD says why.
 */
export const subtaskOverrideSchema = z.object({
  /** FR-23: required when a subtask deadline exceeds the job deadline. */
  deadlineOverrideReason: z.string().trim().min(5).max(500).optional(),
  /** Required when the assignee is not in the subtask's department. */
  assigneeOverrideReason: z.string().trim().min(5).max(500).optional(),
});

export const createSubtaskSchema = subtaskDraftSchema.merge(subtaskOverrideSchema);
export type CreateSubtaskInput = z.infer<typeof createSubtaskSchema>;

export const bulkCreateSubtasksSchema = z.object({
  subtasks: z
    .array(createSubtaskSchema)
    .min(1, 'Add at least one subtask.')
    .max(50, 'That is more subtasks than a single job should have.'),
});

export type BulkCreateSubtasksInput = z.infer<typeof bulkCreateSubtasksSchema>;

/** MD-only metadata edit (build spec M4.2). Status is not editable here. */
export const updateSubtaskSchema = subtaskDraftSchema
  .pick({
    title: true,
    description: true,
    assigneeId: true,
    requiresApproval: true,
    reminderLeadMinutes: true,
    dependsOnId: true,
  })
  .partial()
  .merge(subtaskOverrideSchema)
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: 'Nothing to update.',
  });

export type UpdateSubtaskInput = z.infer<typeof updateSubtaskSchema>;

/**
 * `POST /api/subtasks/:id/status` — SDD section 6.2.
 *
 * One endpoint for every transition, because they share loading, the state
 * machine call and the cascade. The payload each action needs is validated by
 * the state machine's guards rather than by a union of eight schemas.
 */
export const subtaskStatusChangeSchema = z.object({
  action: subtaskActionSchema,
  /** Completion note, rejection note, hold/cancel reason, problem description. */
  note: z.string().trim().max(5_000).optional(),
  severity: problemSeveritySchema.optional(),
});

export type SubtaskStatusChangeInput = z.infer<typeof subtaskStatusChangeSchema>;

export const changeDeadlineSchema = z.object({
  newDeadline: istDateTimeSchema,
  reason: z
    .string()
    .trim()
    .min(5, 'Give a short reason — it goes on the record.')
    .max(500, 'Use at most 500 characters.'),
  deadlineOverrideReason: z.string().trim().min(5).max(500).optional(),
});

export type ChangeDeadlineInput = z.infer<typeof changeDeadlineSchema>;

export const reassignSchema = z.object({
  assigneeId: z.string().min(1, 'Choose who takes it over.'),
  reason: z
    .string()
    .trim()
    .min(5, 'Give a short reason — it goes on the record.')
    .max(500, 'Use at most 500 characters.'),
  assigneeOverrideReason: z.string().trim().min(5).max(500).optional(),
});

export type ReassignInput = z.infer<typeof reassignSchema>;
