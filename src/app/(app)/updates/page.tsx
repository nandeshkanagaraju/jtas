import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { requireActiveSession } from '@/lib/auth/session';
import { isAppError } from '@/lib/errors';
import { listLiveJobs, getLiveJob } from '@/lib/services/live-updates';
import { liveJobsQuerySchema, liveJobQuerySchema } from '@/lib/live-updates/validation';
import { UpdatesScreen } from './updates-screen';
export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Live updates' };
export default async function UpdatesPage({
  searchParams,
}: {
  searchParams: Promise<{ job?: string }>;
}) {
  const user = await requireActiveSession();
  const requested = (await searchParams).job;
  let detail = null;
  if (requested) {
    try {
      detail = await getLiveJob(user, requested, liveJobQuerySchema.parse({}));
    } catch (error) {
      if (isAppError(error) && error.code === 'NOT_FOUND') notFound();
      throw error;
    }
  }
  const state =
    detail && ['COMPLETED', 'CANCELLED', 'DRAFT'].includes(detail.job.status) ? 'all' : 'active';
  const list = await listLiveJobs(user, liveJobsQuerySchema.parse({ state }));
  if (!detail && list.data[0])
    detail = await getLiveJob(user, list.data[0].id, liveJobQuerySchema.parse({}));
  return (
    <UpdatesScreen
      initialList={list}
      initialDetail={detail}
      initialState={state}
      departmentId={user.departmentId}
    />
  );
}
