'use client';

import { T } from '@/lib/i18n/provider';

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
            <T>{'Approve '}</T>
          </Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => onPanel('reject')}>
            <T>{'Send back '}</T>
          </Button>
        </>
      ) : null}

      {subtask.status === 'PROBLEM' ? (
        <Button size="sm" disabled={busy} onClick={() => onPanel('hold')}>
          <T>{'Resolve problem '}</T>
        </Button>
      ) : null}

      <Button size="sm" variant="outline" disabled={busy} onClick={() => onPanel('deadline')}>
        <T>{'Change deadline '}</T>
      </Button>
      <Button size="sm" variant="outline" disabled={busy} onClick={() => onPanel('reassign')}>
        <T>{'Reassign '}</T>
      </Button>

      {subtask.status === 'ON_HOLD' ? (
        <Button size="sm" variant="outline" disabled={busy} onClick={onUnhold}>
          <T>{'Resume '}</T>
        </Button>
      ) : (
        <Button size="sm" variant="outline" disabled={busy} onClick={() => onPanel('hold')}>
          <T>{'Put on hold '}</T>
        </Button>
      )}

      <Button
        size="sm"
        variant="ghost"
        className="text-destructive"
        disabled={busy}
        onClick={() => onPanel('cancel')}
      >
        <T>{'Cancel subtask '}</T>
      </Button>
    </div>
  );
}

/** The facts panel at the top of the drawer. */
export function SubtaskFacts({ subtask }: { subtask: SubtaskDto }) {
  return (
    <dl className="grid grid-cols-2 gap-3 text-sm">
      <div>
        <dt className="field-label">
          <T>{'Deadline'}</T>
        </dt>
        <dd className="code font-medium">
          {subtask.deadline ? (
            new Intl.DateTimeFormat('en-IN', {
              dateStyle: 'medium',
              timeStyle: 'short',
              timeZone: 'Asia/Kolkata',
            }).format(new Date(subtask.deadline))
          ) : subtask.commitmentDueAt ? (
            <T>{'Awaiting commitment'}</T>
          ) : (
            <T>{'Not their turn'}</T>
          )}
          {subtask.isOverdue ? (
            <span className="text-late block text-xs font-medium">
              <T>{'Overdue'}</T>
            </span>
          ) : null}
        </dd>
      </div>

      <div>
        <dt className="field-label">
          <T>{'Reminder'}</T>
        </dt>
        <dd className="font-medium">
          {formatDuration(subtask.reminderLeadMinutes)} <T>{' before'}</T>
        </dd>
      </div>

      {subtask.dependsOn ? (
        <div className="col-span-2">
          <dt className="field-label">
            <T>{'Waits for'}</T>
          </dt>
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
          <dt className="field-label">
            <T>{'Completion note'}</T>
          </dt>
          <dd>{subtask.completionNote}</dd>
        </div>
      ) : null}
    </dl>
  );
}
