/** Labels shared by the server-rendered list and the client report screen. */
import type { ProductionReportStatus, ProductionSection, ProductionShift } from '@prisma/client';

import { formatIST } from '@/lib/utils/time';

export const STATUS_LABEL: Record<ProductionReportStatus, string> = {
  DRAFT: 'Being filled',
  SUBMITTED: 'Waiting for approval',
  APPROVED: 'Approved',
};

export const STATUS_TONE: Record<ProductionReportStatus, 'neutral' | 'risk' | 'ok'> = {
  DRAFT: 'neutral',
  SUBMITTED: 'risk',
  APPROVED: 'ok',
};

/** "CNC · Day shift · Tue, 24 Nov 2026" */
export function reportHeading(report: {
  section: ProductionSection;
  shift: ProductionShift;
  date: string;
}): string {
  const day = formatIST(new Date(`${report.date}T12:00:00+05:30`), 'EEE, dd MMM yyyy');
  return `${report.section} · ${report.shift === 'DAY' ? 'Day' : 'Night'} shift · ${day}`;
}
