'use client';

import { CheckCircle2, Loader2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ApiError } from '@/lib/api/client';
import { changeSubtaskStatusRequest } from '@/lib/api/subtasks-client';
import { fetchMyTasks, type MyTaskDto, type MyTasksDto } from '@/lib/api/my-tasks-client';
import { BUCKET_ORDER, type BucketName } from '@/lib/domain/task-buckets';
import { cn } from '@/lib/utils';

import { TaskCard } from './task-card';
import type { Severity } from './problem-form';

const BUCKET_LABELS: Record<BucketName, string> = {
  overdue: 'Overdue',
  dueToday: 'Due today',
  dueThisWeek: 'This week',
  blocked: 'Blocked',
  awaitingApproval: 'With the MD',
  later: 'Later',
  recentlyCompleted: 'Done',
};

/** Wording a person would use, per bucket. */
const EMPTY_STATES: Record<BucketName, string> = {
  overdue: 'Nothing is late. Keep it that way.',
  dueToday: 'Nothing due today.',
  dueThisWeek: 'Nothing due in the next seven days.',
  blocked: 'Nothing is waiting on somebody else.',
  awaitingApproval: 'Nothing is sitting with the MD.',
  later: 'Nothing further out.',
  recentlyCompleted: 'Nothing finished in the last week yet.',
};

export function MyTasksScreen({ initial }: { initial: MyTasksDto }) {
  const [data, setData] = useState<MyTasksDto>(initial);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<BucketName>(() => firstNonEmpty(initial));

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setData(await fetchMyTasks());
    } catch {
      // A failed refresh leaves the last good list on screen; the next action
      // will reload again. Nothing is lost.
    } finally {
      setLoading(false);
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

      toast.success(
        action === 'COMPLETE'
          ? task.requiresApproval
            ? 'Sent to the MD for approval.'
            : 'Marked completed.'
          : action === 'START'
            ? 'Started.'
            : 'The MD has been told.',
        result.unblocked.length > 0
          ? { description: `${result.unblocked.length} task is no longer blocked.` }
          : undefined,
      );

      await reload();
    } catch (error) {
      // Roll back to exactly what was on screen before.
      setData(snapshot);
      toast.error(
        error instanceof ApiError ? error.message : 'Could not reach the server. Try again.',
      );
    } finally {
      setBusyId(null);
    }
  }

  const { summary } = data;

  return (
    <div className="space-y-4">
      {/* Sticky summary strip: the three numbers that decide what to do next. */}
      <div className="bg-background/95 sticky top-14 z-10 -mx-4 border-b px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          <Stat label="Overdue" value={summary.overdue} tone="overdue" />
          <Stat label="Due today" value={summary.dueToday} tone="urgent" />
          <Stat label="Open problems" value={summary.openProblems} tone="problem" />
          {loading ? <Loader2 className="text-muted-foreground size-4 animate-spin" /> : null}
        </div>
      </div>

      <Tabs value={tab} onValueChange={(value) => setTab(value as BucketName)}>
        {/*
          Scrolls sideways rather than wrapping. Wrapping fought the base
          component's fixed 36px height and the second row landed on top of the
          first card; a single scrolling strip is also the pattern a phone user
          already knows, and it keeps every tab at a 44px touch target.
        */}
        <TabsList className="-mx-4 w-[calc(100%+2rem)] justify-start gap-1 overflow-x-auto rounded-none px-4 group-data-[orientation=horizontal]/tabs:h-auto sm:mx-0 sm:w-full sm:rounded-lg sm:px-[3px]">
          {BUCKET_ORDER.map((name) => (
            <TabsTrigger key={name} value={name} className="min-h-11 shrink-0 gap-1.5">
              {BUCKET_LABELS[name]}
              {data.buckets[name].length > 0 ? (
                <Badge variant="secondary" className="px-1.5 text-xs">
                  {data.buckets[name].length}
                </Badge>
              ) : null}
            </TabsTrigger>
          ))}
        </TabsList>

        {BUCKET_ORDER.map((name) => (
          <TabsContent key={name} value={name} className="space-y-3">
            {data.buckets[name].length === 0 ? (
              <p className="text-muted-foreground flex items-center gap-2 py-10 text-center text-sm">
                <CheckCircle2 className="size-4" />
                {EMPTY_STATES[name]}
              </p>
            ) : (
              data.buckets[name].map((task) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  busy={busyId === task.id}
                  onAction={(action, payload) => act(task, action, payload)}
                />
              ))
            )}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: 'overdue' | 'urgent' | 'problem';
}) {
  const toneClass =
    value === 0
      ? 'text-muted-foreground'
      : tone === 'overdue'
        ? 'text-state-overdue'
        : tone === 'urgent'
          ? 'text-state-problem'
          : 'text-state-problem';

  return (
    <span className="flex items-baseline gap-1.5">
      <span className={cn('tabular text-lg font-semibold', toneClass)}>{value}</span>
      <span className="text-muted-foreground text-xs">{label}</span>
    </span>
  );
}

/** Opens on the bucket that actually needs attention. */
function firstNonEmpty(data: MyTasksDto): BucketName {
  return BUCKET_ORDER.find((name) => data.buckets[name].length > 0) ?? 'dueToday';
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
