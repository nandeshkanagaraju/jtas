/**
 * How each department's work is timed.
 *
 * Most departments commit one finish date when their turn arrives. Three do not
 * work to a deadline at all:
 *
 *  - Store keeps a running register of material in and out, every day, and
 *    tells Production and Planning about each line (see store-service).
 *  - QA inspects continuously and reports accepted and rejected pieces every
 *    hour.
 *  - Accounts invoices when Planning tells them a job is ready.
 *
 * Production and Quality work to several dates: Production makes the quantity
 * in batches, and Quality inspects each batch on the day it goes. Their task's
 * deadline mirrors the earliest open batch (see batch-service).
 *
 * Pure, so the client and the server read the same rules.
 */

/** Departments whose tasks never get a deadline or a commitment window. */
export const NO_DEADLINE_DEPARTMENT_CODES = ['STORE', 'QA', 'ACCOUNTS'] as const;

/** Departments that plan their task as several dated batches. */
export const BATCH_DEPARTMENT_CODES = ['PRODUCTION', 'QUALITY'] as const;

/** The department that keeps the store register. */
export const STORE_DEPARTMENT_CODE = 'STORE';

/** Told about every store register line. */
export const STORE_INTIMATION_DEPARTMENT_CODES = ['PRODUCTION', 'PLANNING'] as const;

/** Raises the invoice once Planning intimates. */
export const ACCOUNTS_DEPARTMENT_CODE = 'ACCOUNTS';

/** Sends the invoice intimation to Accounts. */
export const PLANNING_DEPARTMENT_CODE = 'PLANNING';

/** Reports hourly instead of to a deadline. */
export const HOURLY_REPORT_DEPARTMENT_CODE = 'QA';

export function worksWithoutDeadline(departmentCode: string | null | undefined): boolean {
  return (NO_DEADLINE_DEPARTMENT_CODES as readonly string[]).includes(departmentCode ?? '');
}

export function plansInBatches(departmentCode: string | null | undefined): boolean {
  return (BATCH_DEPARTMENT_CODES as readonly string[]).includes(departmentCode ?? '');
}

/** What a no-deadline task shows where a date would be. */
export function noDeadlineLabel(departmentCode: string | null | undefined): string {
  switch (departmentCode) {
    case 'STORE':
      return 'No deadline · daily store register';
    case 'QA':
      return 'No deadline · hourly reports';
    case 'ACCOUNTS':
      return 'No deadline · invoice when Planning intimates';
    default:
      return 'No deadline';
  }
}
