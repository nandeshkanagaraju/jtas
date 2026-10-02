/**
 * The settings registry — SDD section 3.4.
 *
 * One entry per key, carrying its Zod schema, its documented default, and the
 * words the settings screen shows. Everything else in the system reads from
 * here: the API validates against these schemas, the screen renders these
 * groups, and the startup check asserts every key parses.
 *
 * A single definition matters more than usual for this table. The values are
 * JSONB, so nothing stops a bad write from putting a string where a number
 * belongs; without one authoritative schema per key, "what is a valid
 * `digest.time`?" gets answered slightly differently by the form, the API and
 * the sweeper, and the disagreement only shows up as mail going out at the
 * wrong hour.
 */
import { z } from 'zod';

/** `HH:mm`, 24-hour, IST. */
export const clockTimeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use a 24-hour time such as 09:00.');

/** JS day numbering, 0 = Sunday, as `working_days` is stored. */
export const workingDaysSchema = z
  .array(z.number().int().min(0).max(6))
  .min(1, 'At least one working day.')
  .max(7)
  .refine((days) => new Set(days).size === days.length, 'A day is listed twice.')
  .transform((days) => [...days].sort((a, b) => a - b));

const emailListSchema = z
  .array(z.string().trim().toLowerCase().email('That is not an email address.'))
  .max(10, 'At most ten extra recipients.')
  .transform((list) => [...new Set(list)]);

/** Which section of the settings screen a key belongs to. */
export type SettingGroup = 'reminders' | 'working-hours' | 'notifications' | 'problems' | 'digest';

export interface SettingDefinition<T = unknown> {
  key: string;
  group: SettingGroup;
  label: string;
  /** One line under the field. Says what the value does, not what it is. */
  help: string;
  schema: z.ZodType<T>;
  default: T;
  /**
   * Written but never read back by the API. Used for the SMTP password, which
   * an administrator can replace but nobody — including another administrator
   * — should be able to retrieve through a JSON endpoint.
   */
  writeOnly?: boolean;
  /** Rendered as a warning beside the field. */
  caution?: string;
}

function define<T>(definition: SettingDefinition<T>): SettingDefinition<T> {
  return definition;
}

/**
 * Every setting, in the order the screen shows them.
 *
 * The first ten are SDD 3.4 verbatim. The mail transport keys below them are
 * additive: SDD 10.3 lists `SMTP_HOST` and friends as environment variables,
 * and they stay that way — these let an administrator override them at runtime
 * without a redeploy, which is the difference between fixing a mail outage in a
 * minute and in a release.
 */
export const SETTING_DEFINITIONS = [
  define({
    key: 'reminder.default_lead_minutes',
    group: 'reminders',
    label: 'Default reminder lead time',
    help: 'How long before a deadline the reminder goes out, unless a subtask overrides it.',
    schema: z
      .number()
      .int('Enter a whole number.')
      .min(1, 'Give at least 1 minute of warning.')
      .max(10_080, 'That is more than 7 days.'),
    default: 360,
    caution:
      'Applies to subtasks published from now on. Reminders already scheduled keep their time.',
  }),
  define({
    key: 'escalation.interval_minutes',
    group: 'reminders',
    label: 'Escalation interval',
    help: 'How long to wait before chasing an overdue subtask again.',
    schema: z.number().int().min(30).max(10_080),
    default: 240,
  }),
  define({
    key: 'escalation.max_count',
    group: 'reminders',
    label: 'Maximum escalations',
    help: 'How many times one overdue subtask is chased before the system stops.',
    schema: z.number().int().min(1).max(10),
    default: 3,
    caution: 'Unbounded chasing trains people to filter the mail (improvement I-10).',
  }),

  define({
    key: 'working_hours.start',
    group: 'working-hours',
    label: 'Working hours start',
    help: 'Reminders held overnight are released at this time.',
    schema: clockTimeSchema,
    default: '09:00',
  }),
  define({
    key: 'working_hours.end',
    group: 'working-hours',
    label: 'Working hours end',
    help: 'Reminders due after this time wait for the next working morning.',
    schema: clockTimeSchema,
    default: '18:00',
  }),
  define({
    key: 'working_days',
    group: 'working-hours',
    label: 'Working days',
    help: 'Days the shop runs. A reminder falling on any other day moves to the next one.',
    schema: workingDaysSchema,
    default: [1, 2, 3, 4, 5, 6],
  }),
  define({
    key: 'suppress_reminders_outside_hours',
    group: 'working-hours',
    label: 'Hold reminders outside working hours',
    help: 'Assignments, reminders and the daily digest wait for the next working slot.',
    schema: z.boolean(),
    default: true,
    caution:
      'Overdue mail ignores this and goes out whenever it happens. A missed deadline is news at 2 AM too.',
  }),

  define({
    key: 'mail.from',
    group: 'notifications',
    label: 'From address',
    help: 'The address every JTAS email is sent from.',
    schema: z.string().trim().email('That is not an email address.'),
    default: 'jtas@jaraaglobal.com',
  }),
  define({
    key: 'mail.md_recipients',
    group: 'notifications',
    label: 'Extra MD recipients',
    help: 'Additional addresses copied on escalations and the daily digest.',
    schema: emailListSchema,
    default: [] as string[],
  }),
  define({
    key: 'mail.smtp_host',
    group: 'notifications',
    label: 'SMTP host',
    help: 'Leave blank to use the SMTP_HOST environment variable.',
    schema: z.string().trim().max(255),
    default: '',
  }),
  define({
    key: 'mail.smtp_port',
    group: 'notifications',
    label: 'SMTP port',
    help: 'Zero means use the SMTP_PORT environment variable.',
    schema: z.number().int().min(0).max(65_535),
    default: 0,
  }),
  define({
    key: 'mail.smtp_user',
    group: 'notifications',
    label: 'SMTP username',
    help: 'Leave blank to use the SMTP_USER environment variable.',
    schema: z.string().trim().max(255),
    default: '',
  }),
  define({
    key: 'mail.smtp_password',
    group: 'notifications',
    label: 'SMTP password',
    help: 'Stored, never shown again. Leave blank to keep the current one.',
    schema: z.string().max(255),
    default: '',
    writeOnly: true,
  }),

  define({
    key: 'problem.min_description_length',
    group: 'problems',
    label: 'Minimum problem description',
    help: 'Characters a member must write before a problem report is accepted.',
    schema: z.number().int().min(0).max(500),
    default: 20,
    caution: 'Too low and "machine down" becomes the whole report; too high and nobody files one.',
  }),

  define({
    key: 'digest.time',
    group: 'digest',
    label: 'Daily digest time',
    help: 'When the MD’s summary of overdue work, today’s deadlines and open problems is sent.',
    schema: clockTimeSchema,
    default: '09:00',
  }),
] as const satisfies readonly SettingDefinition[];

export type SettingKey = (typeof SETTING_DEFINITIONS)[number]['key'];

const BY_KEY = new Map<string, SettingDefinition>(
  SETTING_DEFINITIONS.map((definition) => [definition.key, definition as SettingDefinition]),
);

/** The definition for a key, or undefined if nothing defines it. */
export function settingDefinition(key: string): SettingDefinition | undefined {
  return BY_KEY.get(key);
}

export function isSettingKey(key: string): key is SettingKey {
  return BY_KEY.has(key);
}

/** Every key, in registry order. */
export const SETTING_KEYS: readonly string[] = SETTING_DEFINITIONS.map((d) => d.key);

/** The documented defaults, for seeding and for the fallback path. */
export function settingDefaults(): Record<string, unknown> {
  return Object.fromEntries(SETTING_DEFINITIONS.map((d) => [d.key, d.default]));
}

/** The groups, in display order, with their headings. */
export const SETTING_GROUPS: Array<{ id: SettingGroup; title: string; blurb: string }> = [
  {
    id: 'reminders',
    title: 'Reminders and escalation',
    blurb: 'When people are told about a deadline, and how often they are chased past it.',
  },
  {
    id: 'working-hours',
    title: 'Working hours',
    blurb: 'The window reminders are allowed to arrive in.',
  },
  {
    id: 'notifications',
    title: 'Email',
    blurb: 'Where mail comes from and who else is copied.',
  },
  {
    id: 'problems',
    title: 'Problem reports',
    blurb: 'What a member must supply when something blocks the work.',
  },
  { id: 'digest', title: 'Daily digest', blurb: 'The Managing Director’s morning summary.' },
];
