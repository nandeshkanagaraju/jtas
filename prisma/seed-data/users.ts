/**
 * Go-live accounts (SDD section 10.5): the MD, an administrator, and one member
 * per department.
 *
 * There is deliberately no shared password here. Each account gets its own
 * random temporary password at seed time, printed once and never stored in
 * plain text — a constant in a file that ships with the repository and appears
 * in design documents is a published credential.
 */
/** The go-live addresses. What production gets, always. */
export const DEFAULT_MD_EMAIL = 'md@jaraaglobal.com';
export const DEFAULT_MEMBER_EMAIL = 'production@jaraaglobal.com';

/**
 * Every seeded account, and the variable that may repoint it.
 *
 * All ten are listed, not the two that happened to need overriding first. The
 * production guard below ignores the whole table, so a machine carrying any of
 * them cannot seed a personal address into the client's database — the earlier
 * version named only two variables, which would have let the other eight
 * through the moment they existed.
 *
 * Unset, each falls back to its go-live `@jaraaglobal.com` address, so pointing
 * a department at a real mailbox later is a `.env` edit and nothing more.
 */
export const SEED_EMAIL_OVERRIDES = [
  { variable: 'SEED_MD_EMAIL', fallback: DEFAULT_MD_EMAIL },
  { variable: 'SEED_ADMIN_EMAIL', fallback: 'admin@jaraaglobal.com' },
  { variable: 'SEED_PLANNING_EMAIL', fallback: 'planning@jaraaglobal.com' },
  { variable: 'SEED_PURCHASE_EMAIL', fallback: 'purchase@jaraaglobal.com' },
  { variable: 'SEED_STORE_EMAIL', fallback: 'store@jaraaglobal.com' },
  { variable: 'SEED_MEMBER_EMAIL', fallback: DEFAULT_MEMBER_EMAIL },
  { variable: 'SEED_QUALITY_EMAIL', fallback: 'quality@jaraaglobal.com' },
  { variable: 'SEED_DISPATCH_EMAIL', fallback: 'dispatch@jaraaglobal.com' },
  { variable: 'SEED_ACCOUNTS_EMAIL', fallback: 'accounts@jaraaglobal.com' },
  { variable: 'SEED_HR_EMAIL', fallback: 'hr@jaraaglobal.com' },
] as const;

export type SeedEmailVariable = (typeof SEED_EMAIL_OVERRIDES)[number]['variable'];

/**
 * Resolves all ten addresses, honouring the environment outside production.
 *
 * @returns each variable's effective address, keyed by variable name.
 */
export function resolveAllSeedEmails(
  env: NodeJS.ProcessEnv = process.env,
  warn: (message: string) => void = console.warn,
  options: { allowEmailOverrides?: boolean } = {},
): Record<SeedEmailVariable, string> {
  const isProduction = env.NODE_ENV === 'production';
  // Only an explicit true from the seed command. No environment variable
  // counts: a value left in .env would silently retire this guard.
  const allowEmailOverrides = options.allowEmailOverrides === true;

  const ignored = SEED_EMAIL_OVERRIDES.filter(({ variable }) => env[variable]?.trim()).map(
    ({ variable }) => variable,
  );

  if (isProduction && !allowEmailOverrides && ignored.length > 0) {
    warn(
      `\n  !!  NODE_ENV=production: ignoring ${ignored.join(', ')}.\n` +
        `  !!  Seeding the go-live roster instead — ${DEFAULT_MD_EMAIL} is the MD.\n` +
        `  !!  Unset ${ignored.length === 1 ? 'it' : 'them'} on this machine if that was not deliberate.\n`,
    );
  }

  if (isProduction && allowEmailOverrides) {
    warn(
      `\n  !!  --allow-email-overrides: this one run will honour SEED_* in production.\n` +
        `  !!  Applied: ${ignored.length > 0 ? ignored.join(', ') : '(none set — go-live addresses)'}.\n` +
        `  !!  A seed without that flag still ignores them and uses ${DEFAULT_MD_EMAIL}.\n`,
    );
  }

  return Object.fromEntries(
    SEED_EMAIL_OVERRIDES.map(({ variable, fallback }) => [
      variable,
      !isProduction || allowEmailOverrides ? env[variable]?.trim() || fallback : fallback,
    ]),
  ) as Record<SeedEmailVariable, string>;
}

/**
 * The MD and Production member addresses.
 *
 * Kept as a named pair because those two are the ones pointed at real
 * mailboxes during testing, and because its tests are the record of *why* the
 * production guard exists: a laptop carrying SEED_MD_EMAIL that then seeds the
 * client's database would otherwise make a personal Gmail address the Managing
 * Director of record — the account that receives every escalation, and the one
 * whose password reset controls the system.
 *
 * Delegates to `resolveAllSeedEmails` so there is one guard rather than two.
 */
export function resolveSeedEmails(
  env: NodeJS.ProcessEnv = process.env,
  warn: (message: string) => void = console.warn,
  options: { allowEmailOverrides?: boolean } = {},
): { mdEmail: string; memberEmail: string } {
  const all = resolveAllSeedEmails(env, warn, options);
  return { mdEmail: all.SEED_MD_EMAIL, memberEmail: all.SEED_MEMBER_EMAIL };
}

export interface SeedUser {
  name: string;
  email: string;
  role: 'MD' | 'DEPUTY_MD' | 'ADMIN' | 'MEMBER';
  departmentCode: string | null;
}

const ROSTER: Array<{
  name: string;
  role: SeedUser['role'];
  departmentCode: string | null;
  emailVariable: SeedEmailVariable;
}> = [
  { name: 'Managing Director', role: 'MD', departmentCode: null, emailVariable: 'SEED_MD_EMAIL' },
  { name: 'System Admin', role: 'ADMIN', departmentCode: null, emailVariable: 'SEED_ADMIN_EMAIL' },
  {
    name: 'Planning Member',
    role: 'MEMBER',
    departmentCode: 'PLANNING',
    emailVariable: 'SEED_PLANNING_EMAIL',
  },
  {
    name: 'Purchase Member',
    role: 'MEMBER',
    departmentCode: 'PURCHASE',
    emailVariable: 'SEED_PURCHASE_EMAIL',
  },
  {
    name: 'Store Member',
    role: 'MEMBER',
    departmentCode: 'STORE',
    emailVariable: 'SEED_STORE_EMAIL',
  },
  {
    name: 'Production Member',
    role: 'MEMBER',
    departmentCode: 'PRODUCTION',
    emailVariable: 'SEED_MEMBER_EMAIL',
  },
  {
    name: 'Quality Member',
    role: 'MEMBER',
    departmentCode: 'QUALITY',
    emailVariable: 'SEED_QUALITY_EMAIL',
  },
  {
    name: 'Dispatch Member',
    role: 'MEMBER',
    departmentCode: 'DISPATCH',
    emailVariable: 'SEED_DISPATCH_EMAIL',
  },
  {
    name: 'Accounts Member',
    role: 'MEMBER',
    departmentCode: 'ACCOUNTS',
    emailVariable: 'SEED_ACCOUNTS_EMAIL',
  },
  { name: 'HR Member', role: 'MEMBER', departmentCode: 'HR', emailVariable: 'SEED_HR_EMAIL' },
];

/** The ten accounts, with the production guard applied unless the flag is passed. */
export function buildSeedUsers(
  env: NodeJS.ProcessEnv = process.env,
  warn: (message: string) => void = console.warn,
  options: { allowEmailOverrides?: boolean } = {},
): SeedUser[] {
  const emails = resolveAllSeedEmails(env, warn, options);
  return ROSTER.map((row) => ({
    name: row.name,
    role: row.role,
    departmentCode: row.departmentCode,
    email: emails[row.emailVariable],
  }));
}
