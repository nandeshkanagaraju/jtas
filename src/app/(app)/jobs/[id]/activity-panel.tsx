'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { History, Loader2 } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { apiFetch } from '@/lib/api/client';
import type { AuditEntry } from '@/lib/services/audit-query';
import { cn } from '@/lib/utils';
import { formatIST } from '@/lib/utils/time';

/** How many of the most recent actions the card shows before deferring to /audit. */
const PREVIEW = 8;

/**
 * The job's recent history, from the audit log (build spec M9.4).
 *
 * Newest first here, unlike the full trace at `/audit?job=…`, which reads
 * oldest first: somebody opening a job wants to know what just happened, and
 * somebody opening the trace is reading the story from the beginning.
 *
 * Only rendered for a reader who may see the audit log at all — MD and ADMIN,
 * per SDD 6.3's matrix. A member's view of the job carries the same facts
 * through the subtask timeline.
 */
export function ActivityPanel({ jobId }: { jobId: string }) {
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;

    apiFetch<{ data: AuditEntry[]; total: number }>(
      `/api/audit?entityType=JOB&entityId=${jobId}&facets=false`,
    )
      .then((result) => live && setEntries(result.data))
      .catch(() => live && setFailed(true));

    return () => {
      live = false;
    };
  }, [jobId]);

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
              Every status change, deadline change and decision, with who and when.
            </CardDescription>
          </div>

          <Link
            href={`/audit?job=${jobId}`}
            className="text-muted-foreground hover:text-foreground shrink-0 text-xs underline-offset-4 hover:underline"
          >
            Full history, subtasks included
          </Link>
        </div>
      </CardHeader>

      <CardContent>
        {failed ? (
          <p className="text-muted-foreground text-sm">Could not load the history.</p>
        ) : entries === null ? (
          <p className="text-muted-foreground flex items-center gap-2 text-sm">
            <Loader2 className="size-3.5 animate-spin" />
            Loading…
          </p>
        ) : entries.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            Nothing recorded against the job itself yet.
          </p>
        ) : (
          <ol className="divide-y">
            {entries.slice(0, PREVIEW).map((entry) => (
              <li key={entry.id} className="flex flex-wrap items-baseline gap-x-2 gap-y-1 py-2">
                <span className="text-muted-foreground tabular w-36 shrink-0 text-xs">
                  {formatIST(new Date(entry.createdAt))}
                </span>

                <Badge
                  variant="outline"
                  className={cn(
                    'text-xs',
                    /CANCELLED|DELAYED|OVERDUE/.test(entry.action) &&
                      'border-state-overdue/30 text-state-overdue',
                  )}
                >
                  {entry.action.replaceAll('_', ' ').toLowerCase()}
                </Badge>

                <span className="text-sm">{entry.actor?.name ?? 'system'}</span>

                {entry.diff.length > 0 ? (
                  <span className="text-muted-foreground text-xs">
                    {entry.diff
                      .slice(0, 2)
                      .map((change) => `${change.field} ${change.before} → ${change.after}`)
                      .join(', ')}
                  </span>
                ) : null}
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
