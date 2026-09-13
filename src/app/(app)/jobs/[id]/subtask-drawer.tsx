'use client';

import { useEffect, useState } from 'react';

import { IstDateTimePicker } from '@/components/shared/ist-datetime-picker';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Separator } from '@/components/ui/separator';
import { ApiError } from '@/lib/api/client';
import type { UserRow } from '@/lib/api/users-client';
import {
  changeSubtaskDeadlineRequest,
  changeSubtaskStatusRequest,
  reassignSubtaskRequest,
  type SubtaskDto,
} from '@/lib/api/subtasks-client';
import { formatIST } from '@/lib/utils/time';

import { ActionPanel } from './action-panel';
import { SubtaskActions, SubtaskFacts, type ActionPanelName } from './subtask-actions';
import { SubtaskStatusBadge } from './subtask-timeline';

/**
 * MD actions on a single subtask.
 *
 * The drawer only *offers* what the server would accept — a cancelled subtask
 * gets no buttons, an approval only appears when one is pending. That is a
 * convenience, not a control: every action is re-checked by `can()` and by the
 * state machine.
 */
export function SubtaskDrawer({
  subtask,
  open,
  onOpenChange,
  candidates,
  onChanged,
}: {
  subtask: SubtaskDto | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Active, non-admin users who could take the subtask over. */
  candidates: UserRow[];
  onChanged: (message?: string) => void;
}) {
  const [panel, setPanel] = useState<ActionPanelName>('none');
  const [reason, setReason] = useState('');
  const [override, setOverride] = useState('');
  const [newDeadline, setNewDeadline] = useState('');
  const [newAssignee, setNewAssignee] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open || !subtask) return;
    setPanel('none');
    setReason('');
    setOverride('');
    setError(null);
    setNewAssignee(undefined);
    setNewDeadline(formatIST(new Date(subtask.deadline), "yyyy-MM-dd'T'HH:mm"));
  }, [open, subtask]);

  if (!subtask) return null;

  const currentDeadlineValue = formatIST(new Date(subtask.deadline), "yyyy-MM-dd'T'HH:mm");
  const closed = subtask.status === 'COMPLETED' || subtask.status === 'CANCELLED';

  async function run(action: () => Promise<unknown>, message: string) {
    setBusy(true);
    setError(null);
    try {
      await action();
      onChanged(message);
      onOpenChange(false);
    } catch (caught) {
      if (caught instanceof ApiError) {
        // The server asks for a confirmation reason on the two rules that warn
        // rather than block; surface the right panel instead of a dead end.
        const details = caught.details as { requiresOverride?: string } | undefined;
        if (details?.requiresOverride) {
          setError(`${caught.message} Add a confirmation below.`);
        } else {
          setError(caught.message);
        }
      } else {
        setError('Could not reach the server.');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle className="pr-8">{subtask.title}</SheetTitle>
          <SheetDescription className="flex flex-wrap items-center gap-2">
            <SubtaskStatusBadge status={subtask.status} />
            <span>{subtask.department.name}</span>
            <span>· {subtask.assignee.name}</span>
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-4 px-4 pb-6">
          {error ? (
            <Alert variant="destructive" role="alert">
              <AlertTitle>That did not work</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          <SubtaskFacts subtask={subtask} />

          {subtask.openProblem ? (
            <Alert>
              <AlertTitle>
                {subtask.openProblem.severity.charAt(0) +
                  subtask.openProblem.severity.slice(1).toLowerCase()}{' '}
                problem reported
              </AlertTitle>
              <AlertDescription className="whitespace-pre-wrap">
                {subtask.openProblem.description}
              </AlertDescription>
            </Alert>
          ) : null}

          {subtask.exceedsJobDeadline ? (
            <Alert>
              <AlertDescription>This deadline is after the job&rsquo;s own.</AlertDescription>
            </Alert>
          ) : null}

          {closed ? (
            <p className="text-muted-foreground text-sm">
              This subtask is {subtask.status.toLowerCase()} and no longer takes actions.
            </p>
          ) : (
            <>
              <Separator />

              <SubtaskActions
                subtask={subtask}
                busy={busy}
                onPanel={setPanel}
                onApprove={() =>
                  run(
                    () => changeSubtaskStatusRequest(subtask.id, { action: 'APPROVE' }),
                    'Approved.',
                  )
                }
                onUnhold={() =>
                  run(
                    () => changeSubtaskStatusRequest(subtask.id, { action: 'UNHOLD' }),
                    'Resumed.',
                  )
                }
              />
            </>
          )}

          {panel === 'deadline' ? (
            <ActionPanel
              title="Change the deadline"
              note="The reason goes on the record, and the reminder is rescheduled."
              reason={reason}
              onReason={setReason}
              override={override}
              onOverride={setOverride}
              busy={busy}
              // The field is prefilled with the current deadline, and the
              // server rejects a change to the value it already has — so the
              // button stays off until something actually moved.
              disabled={newDeadline === currentDeadlineValue}
              onCancel={() => setPanel('none')}
              onConfirm={() =>
                run(
                  () =>
                    changeSubtaskDeadlineRequest(subtask.id, {
                      newDeadline,
                      reason,
                      deadlineOverrideReason: override || undefined,
                    }),
                  'Deadline changed.',
                )
              }
            >
              <div className="space-y-1.5">
                <Label className="text-xs">New deadline (IST)</Label>
                <IstDateTimePicker value={newDeadline} onChange={setNewDeadline} />
              </div>
            </ActionPanel>
          ) : null}

          {panel === 'reassign' ? (
            <ActionPanel
              title="Reassign"
              note="Both the old and the new owner are notified."
              reason={reason}
              onReason={setReason}
              override={override}
              onOverride={setOverride}
              busy={busy}
              disabled={!newAssignee}
              onCancel={() => setPanel('none')}
              onConfirm={() =>
                run(
                  () =>
                    reassignSubtaskRequest(subtask.id, {
                      assigneeId: newAssignee!,
                      reason,
                      assigneeOverrideReason: override || undefined,
                    }),
                  'Reassigned.',
                )
              }
            >
              <div className="space-y-1.5">
                <Label className="text-xs">New owner</Label>
                <Select value={newAssignee} onValueChange={setNewAssignee}>
                  <SelectTrigger>
                    <SelectValue placeholder="Choose somebody" />
                  </SelectTrigger>
                  <SelectContent>
                    {candidates
                      .filter((user) => user.id !== subtask.assignee.id)
                      .map((user) => (
                        <SelectItem key={user.id} value={user.id}>
                          {user.name}
                          {user.departmentName ? ` · ${user.departmentName}` : ''}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
            </ActionPanel>
          ) : null}

          {panel === 'hold' ? (
            <ActionPanel
              title={subtask.status === 'PROBLEM' ? 'Resolve the problem' : 'Put on hold'}
              note="This goes on the record."
              reason={reason}
              onReason={setReason}
              busy={busy}
              onCancel={() => setPanel('none')}
              onConfirm={() =>
                run(
                  () =>
                    changeSubtaskStatusRequest(subtask.id, {
                      action: subtask.status === 'PROBLEM' ? 'RESOLVE_PROBLEM' : 'HOLD',
                      note: reason,
                    }),
                  subtask.status === 'PROBLEM' ? 'Problem resolved.' : 'Put on hold.',
                )
              }
            />
          ) : null}

          {panel === 'reject' ? (
            <ActionPanel
              title="Send it back"
              note="Say what still needs doing."
              reason={reason}
              onReason={setReason}
              busy={busy}
              onCancel={() => setPanel('none')}
              onConfirm={() =>
                run(
                  () => changeSubtaskStatusRequest(subtask.id, { action: 'REJECT', note: reason }),
                  'Sent back.',
                )
              }
            />
          ) : null}

          {panel === 'cancel' ? (
            <ActionPanel
              title="Cancel this subtask"
              note="It stops being chased. Nothing is deleted."
              destructive
              reason={reason}
              onReason={setReason}
              busy={busy}
              onCancel={() => setPanel('none')}
              onConfirm={() =>
                run(
                  () => changeSubtaskStatusRequest(subtask.id, { action: 'CANCEL', note: reason }),
                  'Subtask cancelled.',
                )
              }
            />
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
