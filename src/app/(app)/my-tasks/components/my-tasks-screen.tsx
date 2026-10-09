'use client';

import { ChevronRight } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';

import { ApiError } from '@/lib/api/client';
import { changeSubtaskStatusRequest } from '@/lib/api/subtasks-client';
import { fetchMyTasks, type MyTaskDto, type MyTasksDto } from '@/lib/api/my-tasks-client';
import { BUCKET_ORDER, type BucketName } from '@/lib/domain/task-buckets';
import { cn } from '@/lib/utils';
import { formatIST } from '@/lib/utils/time';

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
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const today = formatIST(new Date(initial.now), 'EEEE d MMMM');

  const reload = useCallback(async () => {
    try {
      setData(await fetchMyTasks());
      setRefreshError(null);
    } catch {
      // The last good list stays. An empty state here would be a lie.
      setRefreshError('Could not refresh. The list on screen is the last one that loaded.');
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
      const unblocked =
        freed === 1
          ? '1 task is no longer blocked'
          : freed > 1
            ? `${freed} tasks are no longer blocked`
            : null;
      toast.success(
        action === 'COMPLETE'
          ? task.requiresApproval
            ? 'Sent for approval'
            : (unblocked ?? 'Marked completed')
          : action === 'START'
            ? 'Work started'
            : 'Problem reported. The MD has it.',
        action === 'COMPLETE' && task.requiresApproval && unblocked
          ? { description: unblocked }
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

  const overdue = data.buckets.overdue;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header>
        <p className="eyebrow">{today}</p>
        <h1 className="page-title mt-1">My tasks</h1>
        <p className="mt-2 text-base font-medium">{standing(data.summary)}</p>
      </header>

      {refreshError ? (
        <div
          role="alert"
          className="border-late-edge bg-late-soft flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-3"
        >
          <p className="text-late text-sm font-medium">{refreshError}</p>
          <button
            type="button"
            onClick={() => void reload()}
            className="border-late-edge text-late min-h-11 rounded-md border px-3 text-sm font-medium"
          >
            Retry
          </button>
        </div>
      ) : null}

      {/*
        Overdue and due today stay open. A single overdue task is the whole
        screen: large, with its actions, and everything not due now is a count.
      */}
      {OPEN_GROUPS.map((name) => (
        <Group
          key={name}
          name={name}
          tasks={data.buckets[name]}
          emphasis={name === 'overdue' && overdue.length === 1}
          busyId={busyId}
          onAction={act}
        />
      ))}

      <div className="flex flex-wrap gap-2">
        {FOLDED_GROUPS.map((name) => {
          const tasks = data.buckets[name];
          const expanded = open[name] === true;

          return (
            <section key={name} className="min-w-[9.5rem] flex-1">
              <h2>
                <button
                  type="button"
                  aria-expanded={expanded}
                  onClick={() => setOpen((current) => ({ ...current, [name]: !expanded }))}
                  className="border-border bg-card hover:bg-muted/60 flex min-h-11 w-full items-center justify-between gap-3 rounded-md border px-3 text-left text-sm font-medium transition-colors duration-150"
                >
                  <span className="inline-flex items-center gap-1.5">
                    <ChevronRight
                      className={cn(
                        'text-muted-foreground size-4 transition-transform duration-150',
                        expanded && 'rotate-90',
                      )}
                      aria-hidden
                    />
                    {GROUP_LABELS[name]} {tasks.length}
                  </span>
                </button>
              </h2>
              {expanded ? (
                <div className="border-border bg-card mt-2 rounded-md border px-4">
                  <TaskList
                    name={name}
                    tasks={tasks}
                    emphasis={false}
                    busyId={busyId}
                    onAction={act}
                  />
                </div>
              ) : null}
            </section>
          );
        })}
      </div>
    </div>
  );
}

/** One line under the title: what is actually standing against this person. */
function standing(summary: MyTasksDto['summary']): string {
  const parts: string[] = [];
  if (summary.overdue > 0) parts.push(`${summary.overdue} overdue`);
  if (summary.dueToday > 0) parts.push(`${summary.dueToday} due today`);
  if (summary.blocked > 0) parts.push(`${summary.blocked} blocked`);
  if (summary.openProblems > 0) {
    parts.push(
      `${summary.openProblems} open ${summary.openProblems === 1 ? 'problem' : 'problems'}`,
    );
  }

  if (parts.length === 0) return 'Nothing is overdue and nothing is due today.';
  return `${parts.join(', ')}.`;
}

function Group({
  name,
  tasks,
  emphasis,
  busyId,
  onAction,
}: {
  name: BucketName;
  tasks: MyTaskDto[];
  emphasis: boolean;
  busyId: string | null;
  onAction: (
    task: MyTaskDto,
    action: 'START' | 'COMPLETE' | 'PROBLEM',
    payload?: { note: string; severity: Severity },
  ) => void;
}) {
  const countTone = name === 'overdue' && tasks.length > 0 ? 'text-late' : 'text-muted-foreground';

  return (
    <section
      aria-labelledby={`tasks-${name}`}
      className="border-border bg-card overflow-hidden rounded-lg border"
    >
      <h2
        id={`tasks-${name}`}
        className="border-border flex items-center justify-between gap-4 border-b px-4 py-3 text-base font-medium"
      >
        <span>{GROUP_LABELS[name]}</span>
        <span className={cn('font-mono font-medium tabular-nums', countTone)}>{tasks.length}</span>
      </h2>
      <div className="px-4">
        <TaskList
          name={name}
          tasks={tasks}
          emphasis={emphasis}
          busyId={busyId}
          onAction={onAction}
        />
      </div>
    </section>
  );
}

function TaskList({
  name,
  tasks,
  emphasis,
  busyId,
  onAction,
}: {
  name: BucketName;
  tasks: MyTaskDto[];
  emphasis: boolean;
  busyId: string | null;
  onAction: (
    task: MyTaskDto,
    action: 'START' | 'COMPLETE' | 'PROBLEM',
    payload?: { note: string; severity: Severity },
  ) => void;
}) {
  if (tasks.length === 0) {
    return <p className="text-muted-foreground py-5 text-base">{EMPTY_STATES[name]}</p>;
  }

  return (
    <div>
      {tasks.map((task) => (
        <TaskCard
          key={task.id}
          task={task}
          section={name}
          emphasis={emphasis}
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
