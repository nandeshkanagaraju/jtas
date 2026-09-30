'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';

import { ApiError } from '@/lib/api/client';
import { changeSubtaskStatusRequest } from '@/lib/api/subtasks-client';
import { fetchMyTasks, type MyTaskDto, type MyTasksDto } from '@/lib/api/my-tasks-client';
import { BUCKET_ORDER, type BucketName } from '@/lib/domain/task-buckets';

import { TaskCard } from './task-card';
import type { Severity } from './problem-form';

/** Overdue and due today stay open. The rest is a count until asked for. */
const OPEN_GROUPS: BucketName[] = ['overdue', 'dueToday'];

const FOLDED_GROUPS: BucketName[] = [
  'dueThisWeek',
  'blocked',
  'awaitingApproval',
  'later',
  'recentlyCompleted',
];

const GROUP_LABELS: Record<BucketName, string> = {
  overdue: 'Overdue',
  dueToday: 'Due today',
  dueThisWeek: 'This week',
  blocked: 'Blocked',
  awaitingApproval: 'With the MD',
  later: 'Later',
  recentlyCompleted: 'Done',
};

const EMPTY_STATES: Record<BucketName, string> = {
  overdue: 'Nothing is overdue.',
  dueToday: 'Nothing is due today.',
  dueThisWeek: 'Nothing is due this week.',
  blocked: 'Nothing is waiting on another department.',
  awaitingApproval: 'Nothing is with the MD.',
  later: 'Nothing is due later.',
  recentlyCompleted: 'Nothing finished this week.',
};

export function MyTasksScreen({ initial }: { initial: MyTasksDto }) {
  const [data, setData] = useState<MyTasksDto>(initial);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [open, setOpen] = useState<Partial<Record<BucketName, boolean>>>({});

  const reload = useCallback(async () => {
    try {
      setData(await fetchMyTasks());
    } catch {
      // A failed refresh leaves the last good list on screen; the next action
      // will reload again. Nothing is lost.
    }
  }, []);

  // Refresh when the member comes back to the tab — a deadline may have passed
  // or the MD may have unblocked something while the phone was in a pocket.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') void reload();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [reload]);

  /**
   * Applies the action optimistically, then reconciles.
   *
   * The card disappears from its bucket immediately, because on a shop floor a
   * tap that appears to do nothing gets tapped again. On failure the previous
   * state is restored exactly and the error is shown — the optimism is never
   * allowed to hide a refusal.
   */
  async function act(
    task: MyTaskDto,
    action: 'START' | 'COMPLETE' | 'PROBLEM',
    payload?: { note: string; severity: Severity },
  ) {
    const snapshot = data;
    setBusyId(task.id);

    setData((current) => applyOptimistically(current, task, action));

    try {
      const result = await changeSubtaskStatusRequest(task.id, {
        action,
        note: payload?.note,
        severity: payload?.severity,
      });

      const freed = result.unblocked.length;
      toast.success(
        action === 'COMPLETE'
          ? task.requiresApproval
            ? 'Sent for approval.'
            : 'Completed.'
          : action === 'START'
            ? 'Work started.'
            : 'Problem reported.',
        freed > 0
          ? {
              description:
                freed === 1
                  ? '1 task is no longer blocked.'
                  : `${freed} tasks are no longer blocked.`,
            }
          : undefined,
      );

      await reload();
    } catch (error) {
      // Roll back to exactly what was on screen before.
      setData(snapshot);
      toast.error(
        error instanceof ApiError
          ? error.message
          : 'Not saved. Check the connection and try again.',
      );
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="mx-auto max-w-6xl">
      <div className="space-y-8">
        {OPEN_GROUPS.map((name) => (
          <Group key={name} name={name} tasks={data.buckets[name]} busyId={busyId} onAction={act} />
        ))}
      </div>

      <div className="mt-8 border-t border-[#d5dbe3]">
        {FOLDED_GROUPS.map((name) => {
          const tasks = data.buckets[name];
          const expanded = open[name] === true;

          return (
            <section key={name}>
              <h2>
                <button
                  type="button"
                  aria-expanded={expanded}
                  onClick={() => setOpen((current) => ({ ...current, [name]: !expanded }))}
                  className="flex min-h-12 w-full items-baseline justify-between gap-4 border-b border-[#d5dbe3] py-3 text-left text-base text-[#1c2430] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1c2430]"
                >
                  <span className="font-semibold">{GROUP_LABELS[name]}</span>
                  <span className="tabular text-base font-semibold">{tasks.length}</span>
                </button>
              </h2>
              {expanded ? (
                <TaskList name={name} tasks={tasks} busyId={busyId} onAction={act} />
              ) : null}
            </section>
          );
        })}
      </div>
    </div>
  );
}

function Group({
  name,
  tasks,
  busyId,
  onAction,
}: {
  name: BucketName;
  tasks: MyTaskDto[];
  busyId: string | null;
  onAction: (
    task: MyTaskDto,
    action: 'START' | 'COMPLETE' | 'PROBLEM',
    payload?: { note: string; severity: Severity },
  ) => void;
}) {
  const countTone = name === 'overdue' && tasks.length > 0 ? 'text-[#9f1239]' : 'text-[#1c2430]';

  return (
    <section aria-labelledby={`tasks-${name}`}>
      <h2
        id={`tasks-${name}`}
        className="flex items-baseline justify-between gap-4 border-b border-[#d5dbe3] py-3 text-base font-semibold text-[#1c2430]"
      >
        <span>{GROUP_LABELS[name]}</span>
        <span className={`tabular ${countTone}`}>{tasks.length}</span>
      </h2>
      <TaskList name={name} tasks={tasks} busyId={busyId} onAction={onAction} />
    </section>
  );
}

function TaskList({
  name,
  tasks,
  busyId,
  onAction,
}: {
  name: BucketName;
  tasks: MyTaskDto[];
  busyId: string | null;
  onAction: (
    task: MyTaskDto,
    action: 'START' | 'COMPLETE' | 'PROBLEM',
    payload?: { note: string; severity: Severity },
  ) => void;
}) {
  if (tasks.length === 0) {
    return <p className="py-4 text-base text-[#1c2430]">{EMPTY_STATES[name]}</p>;
  }

  return (
    <div>
      {tasks.map((task) => (
        <TaskCard
          key={task.id}
          task={task}
          section={name}
          busy={busyId === task.id}
          onAction={(action, payload) => onAction(task, action, payload)}
        />
      ))}
    </div>
  );
}

/**
 * Moves a card out of its bucket the instant the member taps.
 *
 * Only removal is modelled, not the destination bucket: the server decides the
 * next status (a completion can become `AWAITING_APPROVAL`), and guessing wrong
 * would flash the wrong state before the reload corrects it.
 */
function applyOptimistically(
  current: MyTasksDto,
  task: MyTaskDto,
  action: 'START' | 'COMPLETE' | 'PROBLEM',
): MyTasksDto {
  if (action === 'START') {
    // Starting keeps the card where it is; only the badge changes.
    return {
      ...current,
      buckets: mapBuckets(current, (item) =>
        item.id === task.id ? { ...item, status: 'IN_PROGRESS' } : item,
      ),
    };
  }

  const buckets = Object.fromEntries(
    BUCKET_ORDER.map((name) => [name, current.buckets[name].filter((item) => item.id !== task.id)]),
  ) as MyTasksDto['buckets'];

  const summary = {
    ...current.summary,
    overdue: buckets.overdue.length,
    dueToday: buckets.dueToday.length,
    openProblems:
      action === 'PROBLEM' ? current.summary.openProblems + 1 : current.summary.openProblems,
  };

  return { ...current, buckets, summary };
}

function mapBuckets(
  current: MyTasksDto,
  fn: (task: MyTaskDto) => MyTaskDto,
): MyTasksDto['buckets'] {
  return Object.fromEntries(
    BUCKET_ORDER.map((name) => [name, current.buckets[name].map(fn)]),
  ) as MyTasksDto['buckets'];
}
