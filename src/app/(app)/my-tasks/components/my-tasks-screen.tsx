'use client';

import { ChevronRight } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';

import { PageHeader } from '@/components/shared/page-header';
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
  const today = formatIST(new Date(initial.now), 'EEEE d MMMM');

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
    <div className="mx-auto max-w-5xl space-y-5">
      <PageHeader
        eyebrow={today}
        title="My tasks"
        lead={standing(data.summary)}
        density="comfortable"
      />

      {/*
        Overdue and due today are open; everything else is a count until it is
        asked for. On a phone in a workshop the first screen has to be the work
        that is actually due, not a scrollable archive of everything assigned.
      */}
      {OPEN_GROUPS.map((name) => (
        <Group key={name} name={name} tasks={data.buckets[name]} busyId={busyId} onAction={act} />
      ))}

      <div className="border-border bg-card overflow-hidden rounded-lg border">
        {FOLDED_GROUPS.map((name) => {
          const tasks = data.buckets[name];
          const expanded = open[name] === true;

          return (
            <section key={name} className="border-border border-t first:border-t-0">
              <h2>
                <button
                  type="button"
                  aria-expanded={expanded}
                  onClick={() => setOpen((current) => ({ ...current, [name]: !expanded }))}
                  className="hover:bg-muted/60 flex min-h-12 w-full items-center justify-between gap-4 px-4 py-3 text-left text-base transition-colors"
                >
                  <span className="font-display inline-flex items-center gap-2 font-semibold">
                    <ChevronRight
                      className={cn(
                        'text-muted-foreground size-4 transition-transform',
                        expanded && 'rotate-90',
                      )}
                      aria-hidden
                    />
                    {GROUP_LABELS[name]}
                  </span>
                  <span className="tabular text-muted-foreground text-base font-medium">
                    {tasks.length}
                  </span>
                </button>
              </h2>
              {expanded ? (
                <div className="border-border border-t px-4">
                  <TaskList name={name} tasks={tasks} busyId={busyId} onAction={act} />
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
  const countTone = name === 'overdue' && tasks.length > 0 ? 'text-late' : 'text-muted-foreground';

  return (
    <section
      aria-labelledby={`tasks-${name}`}
      className="border-border bg-card overflow-hidden rounded-lg border"
    >
      <h2
        id={`tasks-${name}`}
        className="font-display border-border flex items-center justify-between gap-4 border-b px-4 py-3 text-base font-semibold"
      >
        <span>{GROUP_LABELS[name]}</span>
        <span className={cn('tabular font-medium', countTone)}>{tasks.length}</span>
      </h2>
      <div className="px-4">
        <TaskList name={name} tasks={tasks} busyId={busyId} onAction={onAction} />
      </div>
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
    return <p className="text-muted-foreground py-5 text-base">{EMPTY_STATES[name]}</p>;
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
