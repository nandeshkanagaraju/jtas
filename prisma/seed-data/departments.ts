/**
 * The eight functions a CNC job passes through, in real shop sequence
 * (PDD section 6.1). `sequenceOrder` drives the left-to-right band order on the
 * MD's job timeline, so it is layout as well as data.
 */
export interface SeedDepartment {
  code: string;
  name: string;
  sequenceOrder: number;
}

export const SEED_DEPARTMENTS: SeedDepartment[] = [
  { code: 'PLANNING', name: 'Planning', sequenceOrder: 1 },
  { code: 'PURCHASE', name: 'Purchase', sequenceOrder: 2 },
  { code: 'STORE', name: 'Store', sequenceOrder: 3 },
  { code: 'PRODUCTION', name: 'Production', sequenceOrder: 4 },
  { code: 'QUALITY', name: 'Quality', sequenceOrder: 5 },
  { code: 'DISPATCH', name: 'Dispatch', sequenceOrder: 6 },
  { code: 'ACCOUNTS', name: 'Accounts', sequenceOrder: 7 },
  { code: 'HR', name: 'HR', sequenceOrder: 8 },
];
