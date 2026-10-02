'use client';

import { Plus, Sparkles, Trash2, TriangleAlert } from 'lucide-react';
import { useMemo } from 'react';

import { IstDateTimePicker } from '@/components/shared/ist-datetime-picker';
import { ReminderLeadField } from '@/components/shared/reminder-lead-field';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { DepartmentSummary } from '@/lib/services/department-service';
import type { UserRow } from '@/lib/api/users-client';
import { reminderLeadMinutesProblem } from '@/lib/domain/reminder-lead';
import { cn } from '@/lib/utils';
import { fromISTInput } from '@/lib/utils/time';

/** One editable row in the builder. `key` is local and becomes `dependsOnKey`. */
export interface SubtaskRowDraft {
  key: string;
  departmentId: string;
  assigneeId: string;
  title: string;
  deadline: string;
  reminderLeadMinutes: number;
  requiresApproval: boolean;
  dependsOnKey: string | null;
}

const NO_DEPENDENCY = '__none__';

/** What a row must have before the MD can move on. */
export function rowProblems(row: SubtaskRowDraft): string[] {
  const problems: string[] = [];
  if (!row.departmentId) problems.push('Choose a department.');
  if (!row.assigneeId) problems.push('Choose who is responsible.');
  if (row.title.trim().length < 3) problems.push('Give it a title.');
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(row.deadline)) problems.push('Set a deadline.');
  const lead = reminderLeadMinutesProblem(row.reminderLeadMinutes);
  if (lead) problems.push(lead);
  return problems;
}

/** Step 2 may open the review only when every row is complete, including the lead. */
export function canReviewRows(rows: SubtaskRowDraft[]): boolean {
  return rows.length > 0 && rows.every((row) => rowProblems(row).length === 0);
}

export function SubtaskBuilder({
  rows,
  onChange,
  departments,
  users,
  jobDeadline,
  onApplyTemplate,
  templateName,
}: {
  rows: SubtaskRowDraft[];
  onChange: (rows: SubtaskRowDraft[]) => void;
  departments: DepartmentSummary[];
  users: UserRow[];
  /** Naive IST wall-clock string; used to warn about late deadlines (FR-23). */
  jobDeadline: string;
  onApplyTemplate: () => void;
  templateName: string | null;
}) {
  const usersByDepartment = useMemo(() => {
    const map = new Map<string, UserRow[]>();
    for (const user of users) {
      if (!user.isActive || user.role === 'ADMIN') continue;
      const key = user.departmentId ?? '__none__';
      map.set(key, [...(map.get(key) ?? []), user]);
    }
    return map;
  }, [users]);

  function update(index: number, patch: Partial<SubtaskRowDraft>) {
    onChange(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  function remove(index: number) {
    const removed = rows[index];
    onChange(
      rows
        .filter((_, i) => i !== index)
        // Anything that depended on the removed row loses its dependency
        // rather than pointing at nothing.
        .map((row) => (row.dependsOnKey === removed.key ? { ...row, dependsOnKey: null } : row)),
    );
  }

  function add() {
    onChange([
      ...rows,
      {
        key: `row-${Date.now()}-${rows.length}`,
        departmentId: departments[0]?.id ?? '',
        assigneeId: '',
        title: '',
        deadline: '',
        reminderLeadMinutes: 360,
        requiresApproval: false,
        dependsOnKey: null,
      },
    ]);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="space-y-0.5">
          <h2 className="font-medium">Department subtasks</h2>
          <p className="text-muted-foreground text-sm">
            One row per piece of work. Each needs an owner and a deadline — that is what the system
            chases.
          </p>
        </div>

        <div className="flex gap-2">
          {templateName ? (
            <Button type="button" variant="outline" onClick={onApplyTemplate}>
              <Sparkles className="size-4" />
              Apply “{templateName}”
            </Button>
          ) : null}
          <Button type="button" variant="outline" onClick={add}>
            <Plus className="size-4" />
            Add row
          </Button>
        </div>
      </div>

      {rows.length === 0 ? (
        <Alert>
          <AlertTitle>No subtasks yet</AlertTitle>
          <AlertDescription>
            {templateName
              ? `Apply “${templateName}” to start from the standard CNC chain, then edit anything that differs.`
              : 'Add a row for each department that has work to do.'}
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="space-y-3">
        {rows.map((row, index) => {
          // Only earlier rows can be depended on, which makes a cycle
          // impossible to express in the first place.
          const earlier = rows.slice(0, index);
          const candidates = usersByDepartment.get(row.departmentId) ?? [];
          const problems = rowProblems(row);
          const leadProblem = reminderLeadMinutesProblem(row.reminderLeadMinutes);
          const otherProblems = problems.filter((problem) => problem !== leadProblem);
          const late = row.deadline !== '' && jobDeadline !== '' && row.deadline > jobDeadline;

          return (
            <div
              key={row.key}
              className={cn(
                'bg-card space-y-3 rounded-lg border p-3',
                problems.length > 0 && 'border-destructive/40',
              )}
            >
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div className="space-y-1.5">
                  <Label className="text-xs">Department</Label>
                  <Select
                    value={row.departmentId || undefined}
                    onValueChange={(value) =>
                      // Changing department invalidates the assignee, who was
                      // filtered to the old one.
                      update(index, { departmentId: value, assigneeId: '' })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Department" />
                    </SelectTrigger>
                    <SelectContent>
                      {departments.map((department) => (
                        <SelectItem key={department.id} value={department.id}>
                          {department.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs">Assignee</Label>
                  <Select
                    value={row.assigneeId || undefined}
                    onValueChange={(value) => update(index, { assigneeId: value })}
                    disabled={!row.departmentId}
                  >
                    <SelectTrigger>
                      <SelectValue
                        placeholder={
                          candidates.length === 0 ? 'Nobody in this department' : 'Choose'
                        }
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {candidates.map((user) => (
                        <SelectItem key={user.id} value={user.id}>
                          {user.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5 lg:col-span-2">
                  <Label className="text-xs">Title</Label>
                  <Input
                    value={row.title}
                    onChange={(event) => update(index, { title: event.target.value })}
                    placeholder="What has to be done"
                  />
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div className="space-y-1.5 lg:col-span-2">
                  <Label htmlFor={`subtask-deadline-${index}`} className="text-xs">
                    Deadline (IST)
                  </Label>
                  <IstDateTimePicker
                    id={`subtask-deadline-${index}`}
                    value={row.deadline}
                    onChange={(value) => update(index, { deadline: value })}
                  />
                </div>

                <ReminderLeadField
                  id={`reminder-lead-${index}`}
                  minutes={row.reminderLeadMinutes}
                  deadline={
                    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(row.deadline)
                      ? fromISTInput(row.deadline)
                      : null
                  }
                  onMinutes={(reminderLeadMinutes) => update(index, { reminderLeadMinutes })}
                />

                <div className="space-y-1.5">
                  <Label className="text-xs">Depends on</Label>
                  <Select
                    value={row.dependsOnKey ?? NO_DEPENDENCY}
                    onValueChange={(value) =>
                      update(index, { dependsOnKey: value === NO_DEPENDENCY ? null : value })
                    }
                    disabled={earlier.length === 0}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Nothing" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_DEPENDENCY}>Nothing</SelectItem>
                      {earlier.map((candidate, position) => (
                        <SelectItem key={candidate.key} value={candidate.key}>
                          {position + 1}. {candidate.title || 'Untitled'}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="border-input accent-primary size-4 rounded border"
                    checked={row.requiresApproval}
                    onChange={(event) => update(index, { requiresApproval: event.target.checked })}
                  />
                  Needs MD approval to count as done
                </label>

                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => remove(index)}
                  aria-label={`Remove row ${index + 1}`}
                >
                  <Trash2 className="size-4" />
                  Remove
                </Button>
              </div>

              {otherProblems.length > 0 ? (
                <p className="text-destructive text-xs">{otherProblems.join(' ')}</p>
              ) : null}

              {late ? (
                <p className="text-state-problem flex items-center gap-1 text-xs">
                  <TriangleAlert className="size-3" />
                  This is after the job deadline. You will be asked to confirm why.
                </p>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
