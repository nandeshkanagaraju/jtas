'use client';

import { useState } from 'react';

import { IstDateTimePicker } from '@/components/shared/ist-datetime-picker';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import type { UserRow } from '@/lib/api/users-client';
import type { DepartmentSummary } from '@/lib/services/department-service';
import { cn } from '@/lib/utils';
import type { ResolutionAction, ResolveProblemInput } from '@/lib/validation/problem';

/**
 * The five resolutions, each described by what it does to the work — not by
 * what it does to the record. The MD is choosing an outcome, not a status.
 */
const ACTIONS: Array<{ value: ResolutionAction; label: string; help: string }> = [
  { value: 'RESUME', label: 'Carry on', help: 'The blockage is cleared. Nothing else changes.' },
  { value: 'EXTEND', label: 'Give more time', help: 'Move the deadline and resume the work.' },
  { value: 'REASSIGN', label: 'Give it to someone else', help: 'Hand the task to another person.' },
  {
    value: 'ESCALATE_TO_DEPARTMENT',
    label: 'Another department must act',
    help: 'Create a task for them, and make this one wait for it.',
  },
  { value: 'CANCEL_SUBTASK', label: 'Call it off', help: 'Cancel the task. Nothing is deleted.' },
];

export interface ResolutionDraft extends Partial<ResolveProblemInput> {
  action: ResolutionAction;
  mdActionNote: string;
}

/**
 * Collects the decision.
 *
 * The action note is mandatory on every path, which is the point: "what did you
 * do about it?" has to be answerable from the record a year later, and a
 * resolution with no reason is indistinguishable from ignoring the problem.
 */
export function ResolutionForm({
  draft,
  onChange,
  departments,
  candidates,
  currentDeadline,
  busy,
}: {
  draft: ResolutionDraft;
  onChange: (next: ResolutionDraft) => void;
  departments: DepartmentSummary[];
  candidates: UserRow[];
  currentDeadline: string;
  busy: boolean;
}) {
  const [escalationDept, setEscalationDept] = useState('');

  const set = (patch: Partial<ResolutionDraft>) => onChange({ ...draft, ...patch });

  const escalationCandidates = candidates.filter(
    (user) => !escalationDept || user.departmentId === escalationDept,
  );

  return (
    <div className="space-y-4">
      <fieldset className="space-y-2">
        <legend className="mb-2 text-sm font-medium">What are you doing about it?</legend>
        {ACTIONS.map((option) => (
          <label
            key={option.value}
            className={cn(
              'flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors',
              draft.action === option.value ? 'border-primary bg-accent/40' : 'hover:bg-accent/30',
            )}
          >
            <input
              type="radio"
              name="resolution"
              className="accent-primary mt-1 size-4"
              checked={draft.action === option.value}
              onChange={() => set({ action: option.value })}
              disabled={busy}
            />
            <span className="space-y-0.5">
              <span className="block text-sm font-medium">{option.label}</span>
              <span className="text-muted-foreground block text-xs">{option.help}</span>
            </span>
          </label>
        ))}
      </fieldset>

      {draft.action === 'EXTEND' ? (
        <div className="space-y-1.5">
          <Label className="text-xs">New deadline (currently {currentDeadline})</Label>
          <IstDateTimePicker
            value={draft.newDeadline ?? ''}
            onChange={(value) => set({ newDeadline: value })}
            disabled={busy}
          />
        </div>
      ) : null}

      {draft.action === 'REASSIGN' ? (
        <div className="space-y-1.5">
          <Label className="text-xs">Who takes it over</Label>
          <Select
            value={draft.assigneeId}
            onValueChange={(value) => set({ assigneeId: value })}
            disabled={busy}
          >
            <SelectTrigger>
              <SelectValue placeholder="Choose somebody" />
            </SelectTrigger>
            <SelectContent>
              {candidates.map((user) => (
                <SelectItem key={user.id} value={user.id}>
                  {user.name}
                  {user.departmentName ? ` · ${user.departmentName}` : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}

      {draft.action === 'ESCALATE_TO_DEPARTMENT' ? (
        <div className="space-y-3 rounded-lg border p-3">
          <p className="text-sm font-medium">The task for the other department</p>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Department</Label>
              <Select
                value={escalationDept || undefined}
                onValueChange={(value) => {
                  setEscalationDept(value);
                  set({
                    escalation: {
                      ...(draft.escalation ?? {
                        title: '',
                        deadline: '',
                        assigneeId: '',
                        blockOriginal: true,
                      }),
                      departmentId: value,
                      // Changing department invalidates the assignee.
                      assigneeId: '',
                    },
                  });
                }}
                disabled={busy}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Choose" />
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
              <Label className="text-xs">Who does it</Label>
              <Select
                value={draft.escalation?.assigneeId || undefined}
                onValueChange={(value) =>
                  set({
                    escalation: { ...draft.escalation!, assigneeId: value },
                  })
                }
                disabled={busy || !escalationDept}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Choose" />
                </SelectTrigger>
                <SelectContent>
                  {escalationCandidates.map((user) => (
                    <SelectItem key={user.id} value={user.id}>
                      {user.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">What they have to do</Label>
            <Input
              value={draft.escalation?.title ?? ''}
              onChange={(event) =>
                set({ escalation: { ...draft.escalation!, title: event.target.value } })
              }
              placeholder="Expedite EN8 bar stock"
              disabled={busy}
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">By when</Label>
            <IstDateTimePicker
              value={draft.escalation?.deadline ?? ''}
              onChange={(value) => set({ escalation: { ...draft.escalation!, deadline: value } })}
              disabled={busy}
            />
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="border-input accent-primary size-4 rounded border"
              checked={draft.escalation?.blockOriginal ?? true}
              onChange={(event) =>
                set({
                  escalation: { ...draft.escalation!, blockOriginal: event.target.checked },
                })
              }
              disabled={busy}
            />
            This task waits for the new one
          </label>
        </div>
      ) : null}

      <div className="space-y-1.5">
        <Label className="text-xs">
          What you decided <span className="text-destructive">*</span>
        </Label>
        <Textarea
          value={draft.mdActionNote}
          onChange={(event) => set({ mdActionNote: event.target.value })}
          rows={3}
          maxLength={2000}
          placeholder="The member sees this, and it stays on the record."
          disabled={busy}
        />
      </div>
    </div>
  );
}
