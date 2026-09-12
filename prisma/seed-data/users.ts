/**
 * Go-live accounts (SDD section 10.5): the MD plus one member per department.
 * Everyone starts with `mustChangePassword = true`, so this password is only
 * ever valid for a single login.
 */
export const TEMP_PASSWORD = 'Jaraa@2026';

export interface SeedUser {
  name: string;
  email: string;
  role: 'MD' | 'DEPUTY_MD' | 'ADMIN' | 'MEMBER';
  departmentCode: string | null;
}

export const SEED_USERS: SeedUser[] = [
  { name: 'Managing Director', email: 'md@jaraaglobal.com', role: 'MD', departmentCode: null },
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
    email: 'production@jaraaglobal.com',
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
