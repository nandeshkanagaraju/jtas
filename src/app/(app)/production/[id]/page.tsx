import type { Metadata } from 'next';
import { forbidden, notFound } from 'next/navigation';

import { isAppError } from '@/lib/errors';

import { ALL_ROLES_WITH_SUPERVISOR, requireActiveSession } from '@/lib/auth/session';
import { canSeeProduction } from '@/lib/services/production/access';
import { getReport, listParts } from '@/lib/services/production/reports';

import { ReportWorkspace } from './report-workspace';

export const metadata: Metadata = { title: 'Shift report' };
export const dynamic = 'force-dynamic';

export default async function ProductionReportPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireActiveSession(ALL_ROLES_WITH_SUPERVISOR);
  if (!canSeeProduction(session)) forbidden();
  const { id } = await params;
  const report = await getReport(session, id).catch((error: unknown) => {
    if (isAppError(error) && error.code === 'NOT_FOUND') notFound();
    throw error;
  });
  const parts = await listParts(report.section);
  return <ReportWorkspace initial={report} parts={parts} />;
}
