import { z } from 'zod';

import { IDLE_REASONS } from '@/lib/domain/production';

const section = z.enum(['CNC', 'VMC']);
const shift = z.enum(['DAY', 'NIGHT']);

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Use at most ${max} characters.`)
    .nullable()
    .optional()
    // Not sent stays undefined (leave it alone); sent blank clears it.
    .transform((value) => (value === undefined ? undefined : value || null));

const quantity = z.coerce
  .number({ invalid_type_error: 'Enter a number.' })
  .int('Enter a whole number.')
  .min(0, 'Cannot be negative.')
  .max(100_000, 'The number is too large.');

const seconds = z.coerce
  .number({ invalid_type_error: 'Enter the seconds as a number.' })
  .min(0, 'Cannot be negative.')
  .max(36_000, 'The number is too large.');

const hours = z.coerce
  .number({ invalid_type_error: 'Enter the hours as a number.' })
  .min(0, 'Cannot be negative.')
  .max(24, 'A shift is at most 24 hours.');

/** Idle minutes by reason; zero and blank entries are dropped. */
export const idleMapSchema = z
  .record(
    z.string(),
    z.coerce
      .number()
      .int()
      .min(0)
      .max(24 * 60),
  )
  .transform((value) => {
    const out: Record<string, number> = {};
    for (const reason of IDLE_REASONS) {
      const minutes = value[reason];
      if (minutes && minutes > 0) out[reason] = minutes;
    }
    return out;
  });

export const openReportSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick the date.'),
  shift,
  section,
});
export type OpenReportInput = z.infer<typeof openReportSchema>;

export const listReportsQuery = z.object({
  status: z.enum(['DRAFT', 'SUBMITTED', 'APPROVED']).optional(),
  section: section.optional(),
});

export const addLineSchema = z.object({
  machineId: z.string().min(1),
  operatorName: text(80),
  partId: z.string().min(1).nullable().optional(),
  partLabel: text(120),
  operation: z.coerce.number().int().min(1).max(6).nullable().optional(),
  cycleSec: seconds.nullable().optional(),
  loadSec: seconds.nullable().optional(),
  /** Set for a machine that stood idle the whole shift: every hour is idle for this reason. */
  idleAllShift: z.enum(IDLE_REASONS).nullable().optional(),
});
export type AddLineInput = z.infer<typeof addLineSchema>;

/** Every field optional: only what is sent changes. `null` clears a typed-over figure. */
export const updateLineSchema = z.object({
  operatorName: text(80),
  partId: z.string().min(1).nullable().optional(),
  partLabel: text(120),
  operation: z.coerce.number().int().min(1).max(6).nullable().optional(),
  cycleSec: seconds.nullable().optional(),
  loadSec: seconds.nullable().optional(),
  pcsPerHourEntered: quantity.nullable().optional(),
  planQtyEntered: quantity.nullable().optional(),
  actualPlanQtyEntered: quantity.nullable().optional(),
  achievedQtyEntered: quantity.nullable().optional(),
  runHoursEntered: hours.nullable().optional(),
  idleEntered: idleMapSchema.nullable().optional(),
  reworkQty: quantity.optional(),
  rejectionQty: quantity.optional(),
  ncReason: text(300),
  remarks: text(500),
  warningNote: text(500),
});
export type UpdateLineInput = z.infer<typeof updateLineSchema>;

export const recordHourSchema = z.object({
  qty: quantity,
  idle: idleMapSchema.default({}),
  note: text(200),
});
export type RecordHourInput = z.infer<typeof recordHourSchema>;

export const remarksSchema = z.object({ remarks: text(2000) });

export const addPartSchema = z.object({
  section,
  customer: text(80),
  partName: z.string().trim().min(1, 'Enter the part name.').max(120),
  partNumber: text(60),
  operation: z.coerce.number().int().min(1).max(6),
  standardCycleSec: seconds.nullable().optional(),
});
export type AddPartInput = z.infer<typeof addPartSchema>;
