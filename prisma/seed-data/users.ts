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
 * Resolves the MD and Production member addresses.
 *
 * They can be pointed at real mailboxes for testing, so escalations and
 * assignments can be read where they would really land — but **never in
 * production**. A laptop that happens to carry SEED_MD_EMAIL in its shell and
 * then seeds the client's database would otherwise make a personal Gmail
 * address the Managing Director of record: the account that receives every
 * escalation, and the one whose password reset controls the system. The
 * override is ignored there and the ignoring is announced, because silently
 * doing the right thing teaches nobody that the variable is set.
 *
 * Kept in the environment rather than written into the roster below, so a
 * personal address is never committed to a repository that ships to the client.
 */
export function resolveSeedEmails(
  env: NodeJS.ProcessEnv = process.env,
  warn: (message: string) => void = console.warn,
): { mdEmail: string; memberEmail: string } {
  const overrides = [
    ['SEED_MD_EMAIL', env.SEED_MD_EMAIL?.trim()],
    ['SEED_MEMBER_EMAIL', env.SEED_MEMBER_EMAIL?.trim()],
  ] as const;

  if (env.NODE_ENV === 'production') {
    const ignored = overrides.filter(([, value]) => value).map(([name]) => name);

    if (ignored.length > 0) {
      warn(
        `\n  !!  NODE_ENV=production: ignoring ${ignored.join(' and ')}.\n` +
          `  !!  Seeding the go-live roster instead — ${DEFAULT_MD_EMAIL} is the MD.\n` +
          `  !!  Unset ${ignored.join(' and ')} on this machine if that was not deliberate.\n`,
      );
    }

    return { mdEmail: DEFAULT_MD_EMAIL, memberEmail: DEFAULT_MEMBER_EMAIL };
  }

  return {
    mdEmail: overrides[0][1] || DEFAULT_MD_EMAIL,
    memberEmail: overrides[1][1] || DEFAULT_MEMBER_EMAIL,
  };
}

const { mdEmail: MD_EMAIL, memberEmail: MEMBER_EMAIL } = resolveSeedEmails();

export interface SeedUser {
  name: string;
  email: string;
  role: 'MD' | 'DEPUTY_MD' | 'ADMIN' | 'MEMBER';
  departmentCode: string | null;
}

export const SEED_USERS: SeedUser[] = [
  { name: 'Managing Director', email: MD_EMAIL, role: 'MD', departmentCode: null },
  { name: 'System Admin', email: 'admin@jaraaglobal.com', role: 'ADMIN', departmentCode: null },
  {
    name: 'Planning Member',
    email: 'planning@jaraaglobal.com',
    role: 'MEMBER',
    departmentCode: 'PLANNING',
  },
  {
    name: 'Purchase Member',
    email: 'purchase@jaraaglobal.com',
    role: 'MEMBER',
    departmentCode: 'PURCHASE',
  },
  {
    name: 'Store Member',
    email: 'store@jaraaglobal.com',
    role: 'MEMBER',
    departmentCode: 'STORE',
  },
  {
    name: 'Production Member',
    email: MEMBER_EMAIL,
    role: 'MEMBER',
    departmentCode: 'PRODUCTION',
  },
  {
    name: 'Quality Member',
    email: 'quality@jaraaglobal.com',
    role: 'MEMBER',
    departmentCode: 'QUALITY',
  },
  {
    name: 'Dispatch Member',
    email: 'dispatch@jaraaglobal.com',
    role: 'MEMBER',
    departmentCode: 'DISPATCH',
  },
  {
    name: 'Accounts Member',
    email: 'accounts@jaraaglobal.com',
    role: 'MEMBER',
    departmentCode: 'ACCOUNTS',
  },
  { name: 'HR Member', email: 'hr@jaraaglobal.com', role: 'MEMBER', departmentCode: 'HR' },
];
