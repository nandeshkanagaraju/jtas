/**
 * Who may do what with the daily production report.
 *
 *   Supervisor  keeps the book: opens a shift, records every hour, reviews the
 *               final report and submits it. Only while it is a draft, and
 *               only for their own section when one is set on their account.
 *   Approver    Planning (PRODUCTION_APPROVER_EMAILS, Planning's login by
 *               default). Sees every report, may correct a submitted one (each
 *               change is recorded) and approves it.
 *   MD, Deputy  see every report, read-only, and get the approved one by mail.
 *
 * Nobody else sees production reports. Separate from `policy.ts` because it
 * reads settings by email, the way job managers are listed.
 */
import type { ProductionReportStatus, ProductionSection, Role } from '@prisma/client';

import { env } from '@/lib/utils/env';

/** Planning's login (Dhiyaneswar S, while Planning and Marketing are swapped). */
export const DEFAULT_PRODUCTION_APPROVER = 'marketing@jaraaglobal.in';

export function productionApproverEmails(): string[] {
  const raw = env().PRODUCTION_APPROVER_EMAILS;
  const list = (raw ?? '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  return list.length ? list : [DEFAULT_PRODUCTION_APPROVER];
}

export interface ProductionSubject {
  id: string;
  email: string;
  role: Role;
  isActive: boolean;
  productionSection?: ProductionSection | null;
}

export function isSupervisor(user: ProductionSubject): boolean {
  return user.isActive && user.role === 'SUPERVISOR';
}

export function isProductionApprover(user: ProductionSubject): boolean {
  return user.isActive && productionApproverEmails().includes(user.email.trim().toLowerCase());
}

export function isProductionViewer(user: ProductionSubject): boolean {
  return user.isActive && (user.role === 'MD' || user.role === 'DEPUTY_MD');
}

/** Sees the production pages at all. */
export function canSeeProduction(user: ProductionSubject): boolean {
  return isSupervisor(user) || isProductionApprover(user) || isProductionViewer(user);
}

/** The sections a supervisor keeps. */
export function supervisorSections(user: ProductionSubject): ProductionSection[] {
  if (!isSupervisor(user)) return [];
  return user.productionSection ? [user.productionSection] : ['CNC', 'VMC'];
}

export function canViewReport(
  user: ProductionSubject,
  report: { section: ProductionSection },
): boolean {
  if (isProductionApprover(user) || isProductionViewer(user)) return true;
  return supervisorSections(user).includes(report.section);
}

/** May change entries: the supervisor on a draft, the approver once submitted. */
export function canEditReport(
  user: ProductionSubject,
  report: { section: ProductionSection; status: ProductionReportStatus },
): boolean {
  if (report.status === 'DRAFT') return supervisorSections(user).includes(report.section);
  if (report.status === 'SUBMITTED') return isProductionApprover(user);
  return false;
}

export function canSubmitReport(
  user: ProductionSubject,
  report: { section: ProductionSection; status: ProductionReportStatus },
): boolean {
  return report.status === 'DRAFT' && supervisorSections(user).includes(report.section);
}

export function canApproveReport(
  user: ProductionSubject,
  report: { status: ProductionReportStatus },
): boolean {
  return report.status === 'SUBMITTED' && isProductionApprover(user);
}
