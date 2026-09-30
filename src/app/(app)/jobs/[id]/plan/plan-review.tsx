'use client';

import { ArrowDown, Lock } from 'lucide-react';

import type { SubtaskRowDraft } from '@/app/(app)/jobs/components/subtask-builder';
import { Badge } from '@/components/ui/badge';
import type { UserRow } from '@/lib/api/users-client';
import type { DepartmentSummary } from '@/lib/services/department-service';
import { cn } from '@/lib/utils';
import { formatDuration } from '@/lib/utils/duration';
import { formatIST, fromISTInput } from '@/lib/utils/time';

/**
 * The chain as it will be published.
 *
 * Rows are shown in dependency order rather than input order, with an arrow
 * where one waits for another — the point of the review step is to see the
 * sequence, not the spreadsheet.
 */
export function PlanReview({
  rows,
  departments,
  users,
}: {
  rows: SubtaskRowDraft[];
  departments: DepartmentSummary[];
  users: UserRow[];
}) {
  const departmentById = new Map(departments.map((d) => [d.id, d]));
  const userById = new Map(users.map((u) => [u.id, u]));
  const indexByKey = new Map(rows.map((row, index) => [row.key, index]));

  return (
    <ol className="space-y-2">
      {rows.map((row, index) => {
        const department = departmentById.get(row.departmentId);
        const assignee = userById.get(row.assigneeId);
        const waitsFor = row.dependsOnKey ? indexByKey.get(row.dependsOnKey) : undefined;

        return (
          <li key={row.key} className="space-y-2">
            {waitsFor !== undefined ? (
              <div className="text-muted-foreground flex items-center gap-1.5 pl-4 text-xs">
                <ArrowDown className="size-3" />
                waits for {waitsFor + 1}. {rows[waitsFor].title || 'Untitled'}
              </div>
            ) : null}

            <div
              className={cn(
                'flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3',
                waitsFor !== undefined && 'ml-4',
              )}
            >
              <div className="min-w-0 space-y-0.5">
                <div className="text-muted-foreground flex items-center gap-2 text-xs">
                  <span>
                    {index + 1}. {department?.name ?? 'Unknown department'}
                  </span>
                  {row.requiresApproval ? (
                    <Badge variant="outline" className="gap-1 text-xs">
                      <Lock className="size-3" />
                      Needs approval
                    </Badge>
                  ) : null}
                  {waitsFor !== undefined ? (
                    <Badge variant="outline" className="text-xs">
                      Starts blocked
                    </Badge>
                  ) : null}
                </div>
                <p className="truncate font-medium">{row.title || 'Untitled'}</p>
                <p className="text-muted-foreground text-xs">
                  {assignee?.name ?? 'Unassigned'} · remind{' '}
                  {formatDuration(row.reminderLeadMinutes)} before
                </p>
              </div>

              <p className="tabular shrink-0 text-sm">
                {row.deadline ? formatIST(fromISTInput(row.deadline)) : 'No deadline'}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
