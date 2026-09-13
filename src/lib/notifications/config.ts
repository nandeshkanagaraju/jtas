/**
 * Loading the operator-owned settings the engine runs on (SDD section 3.4).
 */
import type { Db } from '@/lib/db/prisma';
import { prisma } from '@/lib/db/prisma';
import {
  getSettingBoolean,
  getSettingNumber,
  getSettingString,
} from '@/lib/services/settings-service';
import { istDateKey } from '@/lib/utils/time';

import { toWorkingHoursConfig, type WorkingHoursConfig } from './working-hours';

export interface EscalationConfig {
  /** Minutes between overdue mails. Seeded at 240 (4 hours). */
  intervalMinutes: number;
  /** How many chases before the system stops. Seeded at 3. */
  maxCount: number;
}

export async function loadEscalationConfig(): Promise<EscalationConfig> {
  const [intervalMinutes, maxCount] = await Promise.all([
    getSettingNumber('escalation.interval_minutes', 240),
    getSettingNumber('escalation.max_count', 3),
  ]);

  return { intervalMinutes, maxCount };
}

/** Default reminder lead, used when a subtask has none of its own. */
export async function loadDefaultReminderLeadMinutes(): Promise<number> {
  return getSettingNumber('reminder.default_lead_minutes', 360);
}

/** Whether reminders wait for working hours at all (SDD 3.4). */
export async function loadSuppressOutsideHours(): Promise<boolean> {
  return getSettingBoolean('suppress_reminders_outside_hours', true);
}

/** The IST clock time the daily digest goes out. */
export async function loadDigestTime(): Promise<string> {
  return getSettingString('digest.time', '09:00');
}

/**
 * Working hours plus the holiday calendar.
 *
 * Holidays are loaded as IST date keys so the comparison in `isWorkingDay` is a
 * string lookup rather than a date comparison that could drift by a timezone.
 */
export async function loadWorkingHours(db: Db = prisma): Promise<WorkingHoursConfig> {
  const [start, end, days, holidays] = await Promise.all([
    getSettingString('working_hours.start', '09:00'),
    getSettingString('working_hours.end', '18:00'),
    db.setting.findUnique({ where: { key: 'working_days' } }),
    db.holiday.findMany({ select: { date: true } }),
  ]);

  return toWorkingHoursConfig({
    start,
    end,
    workingDays: days?.value as unknown,
    holidays: holidays.map((holiday) => istDateKey(holiday.date)),
  });
}
