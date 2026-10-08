'use client';

import { ListTodo } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { Panel } from '@/components/shared/panel';
import { EmptyState, ErrorState, ListSkeleton } from '@/components/shared/states';
import { ApiError } from '@/lib/api/client';
import { fetchJobSubtasks, type SubtaskDto } from '@/lib/api/subtasks-client';
import { fetchUsers, type UserRow } from '@/lib/api/users-client';

import { SubtaskDrawer } from './subtask-drawer';
import { SubtaskTimeline } from './subtask-timeline';

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
          Department timeline
        </span>
      }
      id="subtask-timeline"
      description="One step per department, in shop-flow order. Open a step for its history and actions."
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
        <ListSkeleton rows={4} />
      ) : subtasks.length === 0 ? (
        <EmptyState
          icon={ListTodo}
          title="No steps planned yet"
          description="A job needs at least one department subtask before it can be published — plan them from the job wizard."
        />
      ) : (
        <SubtaskTimeline
          subtasks={subtasks}
          selectedId={selected?.id}
          onSelect={(subtask) => {
            setSelected(subtask);
            setDrawerOpen(true);
          }}
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
