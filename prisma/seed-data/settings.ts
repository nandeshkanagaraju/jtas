import type { Prisma } from '@prisma/client';

/**
 * Seeded settings — SDD section 3.4. Values are JSONB so that a setting can
 * grow from a scalar to a structure (working_days is already an array) without
 * a migration.
 */
export const SEED_SETTINGS: Record<string, Prisma.InputJsonValue> = {
  /** Default reminder lead time: 6 hours before the deadline. */
  'reminder.default_lead_minutes': 360,
  /** Repeat the overdue mail every 4 hours… */
  'escalation.interval_minutes': 240,
  /** …at most 3 times, then stop and leave the subtask escalated. */
  'escalation.max_count': 3,
  /** Working hours, IST. */
  'working_hours.start': '09:00',
  'working_hours.end': '18:00',
  /** Monday–Saturday, using JS day numbering where 0 = Sunday. */
  working_days: [1, 2, 3, 4, 5, 6],
  /** MD daily digest, IST. */
  'digest.time': '09:00',
  /** Reminders wait for working hours; overdue mails never do. */
  suppress_reminders_outside_hours: true,
  /** A problem report shorter than this is not a problem report. */
  'problem.min_description_length': 20,
  'mail.from': 'jtas@jaraaglobal.com',
  /** Extra addresses CC'd on MD notifications. */
  'mail.md_recipients': [],
  /*
   * Runtime overrides for the SMTP transport (M9). Empty means "use the
   * environment variable", which is where SDD 10.3 puts them — these exist so
   * a mail outage can be fixed from the settings screen in a minute instead of
   * a redeploy. Seeded blank so a normal boot has nothing to warn about.
   */
  'mail.smtp_host': '',
  'mail.smtp_port': 0,
  'mail.smtp_user': '',
  'mail.smtp_password': '',
};
