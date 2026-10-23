'use client';

import { T } from '@/lib/i18n/provider';

import { Check, CircleAlert, Clock, TriangleAlert } from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import type { SubtaskDto } from '@/lib/api/subtasks-client';
import { formatIST } from '@/lib/utils/time';

/**
 * How a predecessor's state reads in a sentence.
 *
 * Lower-casing the enum gives "is problem" and "is awaiting approval", which is
 * not how anybody speaks; these are the phrasings a person would use.
 */
const PREDECESSOR_STATE: Record<string, string> = {
  PENDING: 'has not been started',
  BLOCKED: 'is itself waiting on something',
  IN_PROGRESS: 'is in progress',
  PROBLEM: 'has hit a problem',
  AWAITING_APPROVAL: 'is waiting for the MD to approve it',
  ON_HOLD: 'is on hold',
  COMPLETED: 'is finished',
  CANCELLED: 'has been cancelled',
};

/**
 * The one-line explanation of why the buttons below look the way they do.
 *
 * Each state answers the member's actual question — "why can't I start?", "did
 * my tap register?", "is anyone dealing with this?" — because a screen that
 * silently disables things gets tapped again and then gets distrusted.
 */
export function TaskStatusAlerts({
  subtask,
  readOnly,
}: {
  subtask: SubtaskDto;
  /** True when the viewer is on the job but does not own this task. */
  readOnly: boolean;
}) {
  return (
    <>
      {readOnly ? (
        <Alert>
          <AlertDescription>
            <T>{'This is '}</T>
            {subtask.assignee.name}
            <T>
              {
                '’s task. You can see it because you are on the same job — it is read-only for you. '
              }
            </T>
          </AlertDescription>
        </Alert>
      ) : null}

      {subtask.status === 'BLOCKED' && subtask.dependsOn ? (
        <Alert>
          <CircleAlert className="size-4" />
          <AlertTitle>
            <T>{'Waiting on somebody else'}</T>
          </AlertTitle>
          <AlertDescription>
            <span className="font-medium">{subtask.dependsOn.title}</span>{' '}
            {PREDECESSOR_STATE[subtask.dependsOn.status] ?? 'is not finished'}
            {subtask.dependsOn.deadline ? (
              `, due ${formatIST(new Date(subtask.dependsOn.deadline))}`
            ) : (
              <T>{', and has not committed a date yet'}</T>
            )}
            <T>{'. You can start once it is done. '}</T>
          </AlertDescription>
        </Alert>
      ) : null}

      {subtask.status === 'PROBLEM' ? (
        <Alert>
          <TriangleAlert className="size-4" />
          <AlertTitle>
            <T>{'Problem reported'}</T>
          </AlertTitle>
          <AlertDescription>
            <T>
              {
                'The MD has this. You are not being chased for it while it is open — you will see the task move once they decide. '
              }
            </T>
          </AlertDescription>
        </Alert>
      ) : null}

      {subtask.status === 'AWAITING_APPROVAL' ? (
        <Alert>
          <Clock className="size-4" />
          <AlertTitle>
            <T>{'With the MD'}</T>
          </AlertTitle>
          <AlertDescription>
            <T>{'You marked this done. It counts as complete once the MD approves it. '}</T>
          </AlertDescription>
        </Alert>
      ) : null}

      {subtask.status === 'COMPLETED' ? (
        <Alert>
          <Check className="size-4" />
          <AlertTitle>
            <T>{'Done'}</T>
          </AlertTitle>
          <AlertDescription>
            <T>{'Completed '}</T>
            {subtask.completedAt ? formatIST(new Date(subtask.completedAt)) : ''}.
            {subtask.completionNote ? ` “${subtask.completionNote}”` : ''}
          </AlertDescription>
        </Alert>
      ) : null}
    </>
  );
}
