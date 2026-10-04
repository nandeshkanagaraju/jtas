'use client';

import { Button } from '@/components/ui/button';
import type { SubtaskDto } from '@/lib/api/subtasks-client';
import { formatDuration } from '@/lib/utils/duration';

export type ActionPanelName = 'none' | 'deadline' | 'reassign' | 'hold' | 'cancel' | 'reject';

/**
 * The action buttons the drawer offers.
 *
 * Only what the server would accept is shown — approve appears only on a
 * subtask awaiting approval, resume only on a held one. That is a convenience,
 * not a control: `can()` and the state machine both re-check every action.
 */
export function SubtaskActions({
  subtask,
  busy,
  onPanel,
  onApprove,
  onUnhold,
}: {
  subtask: SubtaskDto;
  busy: boolean;
  onPanel: (panel: ActionPanelName) => void;
  onApprove: () => void;
  onUnhold: () => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {subtask.status === 'AWAITING_APPROVAL' ? (
        <>
          <Button size="sm" disabled={busy} onClick={onApprove}>
            Approve
          </Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => onPanel('reject')}>
            Send back
          </Button>
        </>
      ) : null}

      {subtask.status === 'PROBLEM' ? (
        <Button size="sm" disabled={busy} onClick={() => onPanel('hold')}>
          Resolve problem
        </Button>
      ) : null}

      <Button size="sm" variant="outline" disabled={busy} onClick={() => onPanel('deadline')}>
        Change deadline
      </Button>
      <Button size="sm" variant="outline" disabled={busy} onClick={() => onPanel('reassign')}>
        Reassign
      </Button>

      {subtask.status === 'ON_HOLD' ? (
        <Button size="sm" variant="outline" disabled={busy} onClick={onUnhold}>
          Resume
        </Button>
      ) : (
        <Button size="sm" variant="outline" disabled={busy} onClick={() => onPanel('hold')}>
          Put on hold
        </Button>
      )}

      <Button
        size="sm"
        variant="ghost"
        className="text-destructive"
        disabled={busy}
        onClick={() => onPanel('cancel')}
      >
        Cancel subtask
      </Button>
    </div>
  );
}

/** The facts panel at the top of the drawer. */
export function SubtaskFacts({ subtask }: { subtask: SubtaskDto }) {
  return (
    <dl className="grid grid-cols-2 gap-3 text-sm">
      <div>
        <dt className="text-muted-foreground text-xs">Deadline</dt>
        <dd className="tabular font-medium">
          {subtask.deadline
            ? new Intl.DateTimeFormat('en-IN', {
                dateStyle: 'medium',
                timeStyle: 'short',
                timeZone: 'Asia/Kolkata',
              }).format(new Date(subtask.deadline))
            : subtask.commitmentDueAt
              ? 'Awaiting commitment'
              : 'Not their turn'}
          {subtask.isOverdue ? (
            <span className="text-state-overdue block text-xs font-medium">Overdue</span>
          ) : null}
        </dd>
      </div>

      <div>
        <dt className="text-muted-foreground text-xs">Reminder</dt>
        <dd className="font-medium">{formatDuration(subtask.reminderLeadMinutes)} before</dd>
      </div>

      {subtask.dependsOn ? (
        <div className="col-span-2">
          <dt className="text-muted-foreground text-xs">Waits for</dt>
          <dd className="font-medium">
            {subtask.dependsOn.title}{' '}
            <span className="text-muted-foreground text-xs">
              ({subtask.dependsOn.status.toLowerCase().replace('_', ' ')})
            </span>
          </dd>
        </div>
      ) : null}

      {subtask.completionNote ? (
        <div className="col-span-2">
          <dt className="text-muted-foreground text-xs">Completion note</dt>
          <dd>{subtask.completionNote}</dd>
        </div>
      ) : null}
    </dl>
  );
}
