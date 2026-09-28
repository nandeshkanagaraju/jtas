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
): Record<SeedEmailVariable, string> {
  const isProduction = env.NODE_ENV === 'production';

  const ignored = SEED_EMAIL_OVERRIDES.filter(({ variable }) => env[variable]?.trim()).map(
    ({ variable }) => variable,
  );

  if (isProduction && ignored.length > 0) {
    warn(
      `\n  !!  NODE_ENV=production: ignoring ${ignored.join(', ')}.\n` +
        `  !!  Seeding the go-live roster instead — ${DEFAULT_MD_EMAIL} is the MD.\n` +
        `  !!  Unset ${ignored.length === 1 ? 'it' : 'them'} on this machine if that was not deliberate.\n`,
    );
  }

  return Object.fromEntries(
    SEED_EMAIL_OVERRIDES.map(({ variable, fallback }) => [
      variable,
      isProduction ? fallback : env[variable]?.trim() || fallback,
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
): { mdEmail: string; memberEmail: string } {
  const all = resolveAllSeedEmails(env, warn);
  return { mdEmail: all.SEED_MD_EMAIL, memberEmail: all.SEED_MEMBER_EMAIL };
}

const EMAILS = resolveAllSeedEmails();

export interface SeedUser {
  name: string;
  email: string;
  role: 'MD' | 'DEPUTY_MD' | 'ADMIN' | 'MEMBER';
  departmentCode: string | null;
}

export const SEED_USERS: SeedUser[] = [
  { name: 'Managing Director', email: EMAILS.SEED_MD_EMAIL, role: 'MD', departmentCode: null },
  { name: 'System Admin', email: EMAILS.SEED_ADMIN_EMAIL, role: 'ADMIN', departmentCode: null },
  {
    name: 'Planning Member',
    email: EMAILS.SEED_PLANNING_EMAIL,
    role: 'MEMBER',
    departmentCode: 'PLANNING',
  },
  {
    name: 'Purchase Member',
    email: EMAILS.SEED_PURCHASE_EMAIL,
    role: 'MEMBER',
    departmentCode: 'PURCHASE',
  },
  {
    name: 'Store Member',
    email: EMAILS.SEED_STORE_EMAIL,
    role: 'MEMBER',
    departmentCode: 'STORE',
  },
  {
    name: 'Production Member',
    email: EMAILS.SEED_MEMBER_EMAIL,
    role: 'MEMBER',
    departmentCode: 'PRODUCTION',
  },
  {
    name: 'Quality Member',
    email: EMAILS.SEED_QUALITY_EMAIL,
    role: 'MEMBER',
    departmentCode: 'QUALITY',
  },
  {
    name: 'Dispatch Member',
    email: EMAILS.SEED_DISPATCH_EMAIL,
    role: 'MEMBER',
    departmentCode: 'DISPATCH',
  },
  {
    name: 'Accounts Member',
    email: EMAILS.SEED_ACCOUNTS_EMAIL,
    role: 'MEMBER',
    departmentCode: 'ACCOUNTS',
  },
  { name: 'HR Member', email: EMAILS.SEED_HR_EMAIL, role: 'MEMBER', departmentCode: 'HR' },
];
