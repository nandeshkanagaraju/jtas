import { z } from 'zod';

/** Generous ceiling: no single report on a CNC job comes near a million parts. */
export const MATERIAL_QTY_MAX = 1_000_000;

const quantity = (label: string) =>
  z.coerce
    .number({ invalid_type_error: `Enter the ${label} quantity as a number.` })
    .int(`Enter the ${label} quantity as a whole number.`)
    .min(0, `The ${label} quantity cannot be negative.`)
    .max(MATERIAL_QTY_MAX, `The ${label} quantity is too large.`);

const time = z
  .string()
  .trim()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Enter the time as HH:MM.')
  .or(z.literal('').transform(() => undefined))
  .transform((value) => value || undefined);

/** Minutes after midnight for an "HH:mm" string. */
export function minutesOf(value: string): number {
  const [hours, minutes] = value.split(':').map(Number);
  return hours * 60 + minutes;
}

/**
 * How long a slot runs, in minutes. A "to" earlier than the "from" is read as
 * the next day, so a night slot 23:00 → 00:00 is one hour.
 */
export function slotMinutes(from: string, to: string): number {
  const span = minutesOf(to) - minutesOf(from);
  return span > 0 ? span : span + 24 * 60;
}

/** A slot longer than this is a typing mistake, not an hourly report. */
export const MAX_SLOT_MINUTES = 12 * 60;

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
    /** "HH:mm", IST. The slot a QA hourly report covers; the date is the day it is sent. */
    timeFrom: time.optional(),
    timeTo: time.optional(),
  })
  .refine((value) => !value.timeFrom === !value.timeTo, {
    message: 'Enter both the from and the to time.',
    path: ['timeTo'],
  })
  .refine((value) => value.acceptedQty + value.rejectedQty > 0, {
    message: 'Enter an accepted or a rejected quantity.',
    path: ['acceptedQty'],
  })
  .refine(
    (value) =>
      !value.timeFrom ||
      !value.timeTo ||
      (value.timeFrom !== value.timeTo &&
        slotMinutes(value.timeFrom, value.timeTo) <= MAX_SLOT_MINUTES),
    { message: 'Check the times: the to time must come after the from time.', path: ['timeTo'] },
  );

export type AddMaterialCountInput = z.infer<typeof addMaterialCountSchema>;
