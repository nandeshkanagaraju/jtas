/**
 * Request shapes for the governance endpoints (build spec M9).
 *
 * Deliberately thin: the per-key rules live in
 * `lib/domain/settings-definitions`, which the service applies. Duplicating
 * them here would create a second answer to "what is a valid digest time".
 */
import { z } from 'zod';

export const updateSettingsSchema = z.object({
  /** Key → value. Every key is validated against its own schema by the service. */
  settings: z.record(z.string(), z.unknown()),
});

export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;

const holidaySchema = z.object({
  date: z.string().trim(),
  name: z.string().trim(),
});

export const addHolidaysSchema = z
  .object({
    holidays: z.array(holidaySchema).optional(),
    /** The annual list, pasted or uploaded as `date,name` lines. */
    csv: z.string().optional(),
  })
  .refine((body) => Boolean(body.csv) || (body.holidays?.length ?? 0) > 0, {
    message: 'Add at least one holiday, or paste a CSV.',
    path: ['holidays'],
  });

export type AddHolidaysInput = z.infer<typeof addHolidaysSchema>;

export const testEmailSchema = z.object({
  to: z.string().trim().toLowerCase().email('That is not an email address.'),
});

const templateItemSchema = z.object({
  departmentId: z.string().min(1, 'Choose a department.'),
  title: z.string().trim().min(3, 'Give the step a title.').max(200),
  offsetHoursBeforeDue: z.number().int().min(0).max(8_760),
  reminderLeadMinutes: z.number().int().min(1).max(10_080).default(360),
  dependsOnItemOrder: z.number().int().min(0).nullable().default(null),
});

export const templateSchema = z.object({
  name: z.string().trim().min(3, 'Give the template a name.').max(120),
  items: z.array(templateItemSchema).min(1, 'A template needs at least one step.').max(30),
});

export type TemplateBody = z.infer<typeof templateSchema>;

export const templateActiveSchema = z.object({ isActive: z.boolean() });

export const addCommentSchema = z.object({
  body: z
    .string()
    .trim()
    .min(1, 'Write something first.')
    .max(2000, 'Use at most 2000 characters.'),
});

export const presignAttachmentSchema = z.object({
  jobId: z.string().min(1),
  subtaskId: z.string().min(1).nullable().optional(),
  fileName: z.string().trim().min(1).max(255),
  contentType: z.string().trim().min(1).max(255),
  sizeBytes: z.number().int().positive(),
});

export const registerAttachmentSchema = z.object({
  attachmentId: z.string().min(1),
  jobId: z.string().min(1),
  subtaskId: z.string().min(1).nullable().optional(),
  fileName: z.string().trim().min(1).max(255),
  contentType: z.string().trim().min(1).max(255),
  storageKey: z.string().min(1).max(512),
});
