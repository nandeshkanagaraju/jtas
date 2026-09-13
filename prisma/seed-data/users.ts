/**
 * Go-live accounts (SDD section 10.5): the MD, an administrator, and one member
 * per department.
 *
 * There is deliberately no shared password here. Each account gets its own
 * random temporary password at seed time, printed once and never stored in
 * plain text — a constant in a file that ships with the repository and appears
 * in design documents is a published credential.
 */
/**
 * The MD and the Production member can be pointed at real mailboxes for
 * testing, so escalations and assignments can be read where they would really
 * land. Kept in the environment rather than in this file: these are the
 * go-live accounts, and a personal address committed here would ship to the
 * client and end up in the design documents.
 */
const MD_EMAIL = process.env.SEED_MD_EMAIL?.trim() || 'md@jaraaglobal.com';
const MEMBER_EMAIL = process.env.SEED_MEMBER_EMAIL?.trim() || 'production@jaraaglobal.com';

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
