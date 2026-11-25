/**
 * The real department logins (one shared account per department).
 *
 * Passwords are set by the organisation, never by the person: each is
 * `<Department name><DEPARTMENT_PASSWORD_SUFFIX>`, applied by
 * `pnpm users:provision-departments`. The suffix lives in `.env`, not here,
 * so this file does not publish the passwords.
 *
 * `passwordName` is the department name as it appears in the password (for
 * the Managing Director, who has no department, it is "MD").
 * `replaces` is the go-live placeholder account this person takes over: its
 * open tasks move to them and the placeholder is deactivated.
 */
export interface DepartmentAccount {
  name: string;
  email: string;
  /** Null for the Managing Director, who sits above the departments. */
  departmentCode: string | null;
  /** Defaults to MEMBER. */
  role?: 'MEMBER' | 'MD';
  passwordName: string;
  replaces?: string;
}

export const DEPARTMENT_ACCOUNTS: DepartmentAccount[] = [
  {
    name: 'S Ramkumar',
    email: 'ramkumar@jaraaglobal.in',
    role: 'MD',
    departmentCode: null,
    passwordName: 'MD',
  },
  {
    name: 'Arun Kumar Pandian',
    email: 'production@jaraaglobal.in',
    replaces: 'production@jaraaglobal.com',
    departmentCode: 'PRODUCTION',
    passwordName: 'Production',
  },
  {
    name: 'Kalpana N',
    email: 'accounts@jaraaglobal.in',
    replaces: 'accounts@jaraaglobal.com',
    departmentCode: 'ACCOUNTS',
    passwordName: 'Accounts',
  },
  {
    name: 'Muniraj M',
    email: 'purchase@jaraaglobal.in',
    replaces: 'purchase@jaraaglobal.com',
    departmentCode: 'PURCHASE',
    passwordName: 'Purchase',
  },
  {
    name: 'Chinnarasu',
    email: 'planning@jaraaglobal.in',
    replaces: 'planning@jaraaglobal.com',
    // Swapped with Dhiyaneswar S for now: Chinnarasu does Marketing's work.
    departmentCode: 'MARKETING',
    passwordName: 'Planning',
  },
  {
    name: 'Hari',
    email: 'stores@jaraaglobal.in',
    replaces: 'store@jaraaglobal.com',
    departmentCode: 'STORE',
    passwordName: 'Store',
  },
  { name: 'Sundaramurthy', email: 'qa@jaraaglobal.in', departmentCode: 'QA', passwordName: 'QA' },
  {
    name: 'Kumar',
    email: 'maintenance@jaraaglobal.in',
    departmentCode: 'MAINTENANCE',
    passwordName: 'Maintenance',
  },
  {
    name: 'Dhiyaneswar S',
    email: 'marketing@jaraaglobal.in',
    // Swapped with Chinnarasu for now: Dhiyaneswar S does Planning's work.
    departmentCode: 'PLANNING',
    passwordName: 'Marketing',
  },
  {
    name: 'HR',
    email: 'hr@jaraaglobal.in',
    replaces: 'hr@jaraaglobal.com',
    departmentCode: 'HR',
    passwordName: 'HR',
  },
];
