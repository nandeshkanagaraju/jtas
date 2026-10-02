'use client';

import { ListTodo } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
  const [subtasks, setSubtasks] = useState<SubtaskDto[]>([]);
  const [candidates, setCandidates] = useState<UserRow[]>([]);
  const [selected, setSelected] = useState<SubtaskDto | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
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
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ListTodo className="size-4" />
          Subtask timeline
        </CardTitle>
        <CardDescription>
          One band per department in shop-flow order. Click a band for its history and actions.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-3">
        {notice ? <p className="text-state-complete text-sm">{notice}</p> : null}
        {error ? (
          <p className="text-destructive text-sm" role="alert">
            {error}
          </p>
        ) : null}

        <SubtaskTimeline
          subtasks={subtasks}
          selectedId={selected?.id}
          onSelect={(subtask) => {
            setSelected(subtask);
            setDrawerOpen(true);
          }}
        />
      </CardContent>

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
    </Card>
  );
}
