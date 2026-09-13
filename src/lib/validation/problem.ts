/**
 * Problem inbox shapes (architecture rule 4).
 */
import { z } from 'zod';

import { istDateTimeSchema } from './job';

export const problemSeveritySchema = z.enum(['LOW', 'MEDIUM', 'HIGH', 'BLOCKER']);
export const problemStatusSchema = z.enum(['OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'REJECTED']);
export const ageBucketSchema = z.enum(['under2h', 'under24h', 'over24h']);

/**
 * The five ways an MD closes a problem (build spec M6.1).
 *
 * Each one is a real decision with a different consequence, which is why this
 * is a radio choice rather than a free-text note: "what did you do about it?"
 * has to be answerable from the record a year later.
 */
export const resolutionActionSchema = z.enum([
  /** Nothing changes but the blockage is cleared; work resumes. */
  'RESUME',
  /** More time. Moves the deadline through the normal change path. */
  'EXTEND',
  /** Somebody else takes it on. */
  'REASSIGN',
  /** The work is called off. */
  'CANCEL_SUBTASK',
  /** Another department has to do something first. */
  'ESCALATE_TO_DEPARTMENT',
]);

export type ResolutionAction = z.infer<typeof resolutionActionSchema>;

/** Mandatory on every resolution — the record of what was decided and why. */
const mdActionNoteSchema = z
  .string()
  .trim()
  .min(5, 'Say what you decided — it goes on the record.')
  .max(2_000, 'Use at most 2000 characters.');

export const resolveProblemSchema = z
  .object({
    action: resolutionActionSchema,
    mdActionNote: mdActionNoteSchema,
    /** EXTEND: the new deadline, as an IST wall-clock string. */
    newDeadline: istDateTimeSchema.optional(),
    /** EXTEND: confirmation when the new deadline passes the job's own. */
    deadlineOverrideReason: z.string().trim().min(5).max(500).optional(),
    /** REASSIGN: who takes it over. */
    assigneeId: z.string().min(1).optional(),
    /** REASSIGN: confirmation when they are in another department. */
    assigneeOverrideReason: z.string().trim().min(5).max(500).optional(),
    /** ESCALATE_TO_DEPARTMENT: the new subtask. */
    escalation: z
      .object({
        departmentId: z.string().min(1, 'Choose a department.'),
        assigneeId: z.string().min(1, 'Choose who is responsible.'),
        title: z.string().trim().min(3, 'Give it a title.').max(200),
        deadline: istDateTimeSchema,
        /**
         * Whether the stuck subtask now waits for the new one. Usually yes —
         * that is what "escalate" means — but the MD can decline if the two
         * can genuinely run in parallel.
         */
        blockOriginal: z.boolean().default(true),
        assigneeOverrideReason: z.string().trim().min(5).max(500).optional(),
      })
      .optional(),
  })
  // Each action needs its own fields; checking here means the service can
  // trust them and the form can show the error against the right input.
  .superRefine((value, ctx) => {
    if (value.action === 'EXTEND' && !value.newDeadline) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['newDeadline'],
        message: 'Choose the new deadline.',
      });
    }
    if (value.action === 'REASSIGN' && !value.assigneeId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['assigneeId'],
        message: 'Choose who takes it over.',
      });
    }
    if (value.action === 'ESCALATE_TO_DEPARTMENT' && !value.escalation) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['escalation'],
        message: 'Describe the work the other department has to do.',
      });
    }
  });

export type ResolveProblemInput = z.infer<typeof resolveProblemSchema>;

export const rejectProblemSchema = z.object({
  note: z
    .string()
    .trim()
    .min(5, 'Say why — the member sees this.')
    .max(2_000, 'Use at most 2000 characters.'),
});

export type RejectProblemInput = z.infer<typeof rejectProblemSchema>;

export const listProblemsQuerySchema = z.object({
  status: problemStatusSchema.optional(),
  severity: problemSeveritySchema.optional(),
  departmentId: z.string().min(1).optional(),
  jobId: z.string().min(1).optional(),
  ageBucket: ageBucketSchema.optional(),
  /** Default view: everything still needing a decision. */
  open: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
});

export type ListProblemsQuery = z.infer<typeof listProblemsQuerySchema>;
