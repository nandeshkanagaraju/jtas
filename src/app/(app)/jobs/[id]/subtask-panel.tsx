'use client';

import { ListTodo } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { JobRelay, relayStations } from '@/components/shared/job-relay';
import { Panel } from '@/components/shared/panel';
import { EmptyState, ErrorState } from '@/components/shared/states';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError } from '@/lib/api/client';
import { fetchJobSubtasks, type SubtaskDto } from '@/lib/api/subtasks-client';
import { fetchUsers, type UserRow } from '@/lib/api/users-client';
import { formatIST } from '@/lib/utils/time';

import { SubtaskDrawer } from './subtask-drawer';

/**
 * The subtask timeline and its action drawer.
 *
 * Loads its own data rather than taking it from the server component, so that
 * an action inside the drawer refreshes the band it changed without a full page
 * navigation.
 */
export function SubtaskPanel({
  jobId,
  canManage,
  currentUserId,
  onJobChanged,
}: {
  jobId: string;
  /** MD and Deputy: whether the drawer offers actions at all. */
  canManage: boolean;
  currentUserId: string;
  onJobChanged: () => void;
}) {
  const [subtasks, setSubtasks] = useState<SubtaskDto[] | null>(null);
  const [candidates, setCandidates] = useState<UserRow[]>([]);
  const [selected, setSelected] = useState<SubtaskDto | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const { data } = await fetchJobSubtasks(jobId);
      setSubtasks(data);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not load the subtasks.');
    }
  }, [jobId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Reassignment candidates are only needed by the drawer, so they are fetched
  // once for an MD and never for a member.
  useEffect(() => {
    if (!canManage) return;
    fetchUsers({ status: 'active', pageSize: 100 })
      .then((result) => setCandidates(result.data.filter((user) => user.role !== 'ADMIN')))
      .catch(() => setCandidates([]));
  }, [canManage]);

  return (
    <Panel
      title={
        <span className="flex items-center gap-2">
          <ListTodo className="size-4" aria-hidden />
          The relay
        </span>
      }
      id="subtask-timeline"
      description="Each department's piece of this job, in shop order. Open a station for its date and its record."
      action={
        notice ? (
          <span className="text-ok text-xs font-medium" role="status">
            {notice}
          </span>
        ) : null
      }
    >
      {error ? (
        <ErrorState message={error} onRetry={() => void load()} />
      ) : subtasks === null ? (
        <RelaySkeleton />
      ) : subtasks.length === 0 ? (
        <EmptyState
          icon={ListTodo}
          title="No steps planned yet"
          description="A job needs at least one department subtask before it can be published — plan them from the job wizard."
        />
      ) : (
        <JobRelay
          stations={withDates(subtasks)}
          density="full"
          onOpen={
            canManage
              ? (stationId) => {
                  const subtask = subtasks.find((row) => row.id === stationId);
                  if (!subtask) return;
                  setSelected(subtask);
                  setDrawerOpen(true);
                }
              : undefined
          }
        />
      )}

      {canManage ? (
        <SubtaskDrawer
          subtask={selected}
          open={drawerOpen}
          onOpenChange={setDrawerOpen}
          candidates={candidates}
          currentUserId={currentUserId}
          onChanged={async (message) => {
            setNotice(message ?? null);
            await load();
            // A subtask change can move the job's derived status.
            onJobChanged();
            window.setTimeout(() => setNotice(null), 4_000);
          }}
        />
      ) : null}
    </Panel>
  );
}

function withDates(subtasks: SubtaskDto[]) {
  const byId = new Map(subtasks.map((row) => [row.id, row]));
  return relayStations(subtasks).map((station) => ({
    ...station,
    when: whenOf(byId.get(station.id)!),
  }));
}

function whenOf(subtask: SubtaskDto): string {
  if (subtask.deadline) return formatIST(new Date(subtask.deadline), 'dd MMM, hh:mm a');
  if (subtask.status === 'BLOCKED' || !subtask.commitmentDueAt) return 'No date yet';
  return 'Awaiting a commitment';
}

function RelaySkeleton() {
  return (
    <div aria-hidden className="space-y-2">
      {Array.from({ length: 6 }, (_, row) => (
        <Skeleton key={row} className="h-14 w-full" />
      ))}
    </div>
  );
}
