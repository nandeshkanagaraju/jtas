'use client';

import Link from 'next/link';
import { History } from 'lucide-react';

import { ActivityFeed } from '@/components/collaboration/activity-feed';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

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
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <History className="size-4" />
              Activity
            </CardTitle>
            <CardDescription>
              Comments, status changes, deadlines, problems and files — newest first.
            </CardDescription>
          </div>

          {canViewAudit ? (
            <Link
              href={`/audit?job=${jobId}`}
              className="text-muted-foreground hover:text-foreground shrink-0 text-xs underline-offset-4 hover:underline"
            >
              Forensic view
            </Link>
          ) : null}
        </div>
      </CardHeader>

      <CardContent>
        <ActivityFeed jobId={jobId} currentUserId={currentUserId} />
      </CardContent>
    </Card>
  );
}
