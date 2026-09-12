/**
 * The "Standard CNC Job" template (PDD improvement I-03).
 *
 * `offsetHoursBeforeDue` is measured backwards from the job's overall deadline,
 * so one template serves a rush job and a long job alike — the whole chain
 * compresses or stretches with the due date. The numbers below are laid out for
 * the typical 15-day (360-hour) order:
 *
 *   day 1 ─ Planning ─ day 3 ─ Purchase ─ day 6 ─ Store ─ day 11 ─ Production
 *         ─ day 13 ─ Quality ─ day 14½ ─ Dispatch ─ day 15 ─ Accounts
 *   HR (manpower and shift allocation) runs in parallel from day 2½.
 *
 * `dependsOnItemOrder` refers to another item's `order` in this same template;
 * the job-creation service resolves it to a real `dependsOnId` once the
 * subtasks exist.
 */
export interface SeedTemplateItem {
  order: number;
  departmentCode: string;
  title: string;
  offsetHoursBeforeDue: number;
  reminderLeadMinutes: number;
  dependsOnItemOrder: number | null;
}

export const STANDARD_CNC_TEMPLATE: {
  name: string;
  items: SeedTemplateItem[];
} = {
  name: 'Standard CNC Job',
  items: [
    {
      order: 1,
      departmentCode: 'PLANNING',
      title: 'Process plan, routing and tooling list',
      offsetHoursBeforeDue: 336, // 14 days before due
      reminderLeadMinutes: 360,
      dependsOnItemOrder: null,
    },
    {
      order: 2,
      departmentCode: 'PURCHASE',
      title: 'Raise PO for raw material and bought-out items',
      offsetHoursBeforeDue: 288, // 12 days before due
      reminderLeadMinutes: 360,
      dependsOnItemOrder: 1,
    },
    {
      order: 3,
      departmentCode: 'STORE',
      title: 'Receive, inspect and issue material to shop floor',
      offsetHoursBeforeDue: 216, // 9 days before due
      reminderLeadMinutes: 360,
      dependsOnItemOrder: 2,
    },
    {
      order: 4,
      departmentCode: 'PRODUCTION',
      title: 'Machining, setup approval and first-piece clearance',
      offsetHoursBeforeDue: 96, // 4 days before due
      reminderLeadMinutes: 720, // 12 h — the longest job on the board
      dependsOnItemOrder: 3,
    },
    {
      order: 5,
      departmentCode: 'QUALITY',
      title: 'Final inspection and inspection report',
      offsetHoursBeforeDue: 48, // 2 days before due
      reminderLeadMinutes: 360,
      dependsOnItemOrder: 4,
    },
    {
      order: 6,
      departmentCode: 'DISPATCH',
      title: 'Packing, documentation and despatch',
      offsetHoursBeforeDue: 12, // half a day before due
      reminderLeadMinutes: 240, // 4 h — short task, short warning
      dependsOnItemOrder: 5,
    },
    {
      order: 7,
      departmentCode: 'ACCOUNTS',
      title: 'Raise invoice and e-way bill',
      offsetHoursBeforeDue: 0, // on the job deadline itself
      reminderLeadMinutes: 240,
      dependsOnItemOrder: 6,
    },
    {
      order: 8,
      departmentCode: 'HR',
      title: 'Manpower and shift allocation for the order',
      offsetHoursBeforeDue: 300, // 12½ days before due — runs in parallel
      reminderLeadMinutes: 360,
      dependsOnItemOrder: null, // parallel branch: no predecessor
    },
  ],
};
