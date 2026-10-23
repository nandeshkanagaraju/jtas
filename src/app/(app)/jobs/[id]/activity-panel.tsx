'use client';

import { T } from '@/lib/i18n/provider';

import Link from 'next/link';
import { History } from 'lucide-react';

import { ActivityFeed } from '@/components/collaboration/activity-feed';
import { Panel } from '@/components/shared/panel';

/**
 * The job's activity (build spec M10.3).
 *
 * M9 filled this card with the job's own audit rows. M10 widens it to the whole
 * story — comments, status changes, deadline changes, problems and attachments
 * from every subtask — because three JOB rows is not what somebody asking "what
 * happened here" wants to read.
 *
 * `/audit?job=…` remains the forensic view: same events, oldest first, with ids
 * and IP addresses. This is the readable one.
 */
export function ActivityPanel({
  jobId,
  currentUserId,
  canViewAudit,
}: {
  jobId: string;
  currentUserId: string;
  canViewAudit: boolean;
}) {
  return (
    <Panel
      id="job-activity"
      title={
        <span className="flex items-center gap-2">
          <History className="size-4" aria-hidden />
          <T>{'Activity '}</T>
        </span>
      }
      description={
        <T>{'Comments, status changes, deadlines, problems and files — newest first.'}</T>
      }
      action={
        <div className="flex flex-wrap items-center gap-3">
          <Link
            href={`/updates?job=${jobId}`}
            className="text-action inline-flex min-h-11 items-center text-xs font-medium underline"
          >
            <T>Live updates</T>
          </Link>
          {canViewAudit ? (
            <Link
              href={`/audit?job=${jobId}`}
              className="text-muted-foreground hover:text-foreground shrink-0 text-xs font-medium underline-offset-4 hover:underline"
            >
              <T>{'Forensic view '}</T>
            </Link>
          ) : null}
        </div>
      }
    >
      <ActivityFeed jobId={jobId} currentUserId={currentUserId} />
    </Panel>
  );
}
