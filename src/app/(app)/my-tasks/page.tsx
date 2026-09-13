import type { Metadata } from 'next';

import { requireActiveSession } from '@/lib/auth/session';
import { getMyTasks } from '@/lib/services/my-tasks-service';

import { MyTasksScreen } from './components/my-tasks-screen';

export const metadata: Metadata = { title: 'My tasks' };
export const dynamic = 'force-dynamic';

/**
 * The member's home screen (FR-30) and the only screen members are trained on
 * (SDD section 10.5).
 *
 * Rendered on the server with the first payload already in place, so the list
 * is readable before any JavaScript runs — on a 4G phone that is the difference
 * between "instant" and "a spinner".
 */
export default async function MyTasksPage() {
  const session = await requireActiveSession();
  const result = await getMyTasks(session.id);

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">My tasks</h1>
        <p className="text-muted-foreground text-sm">
          Everything assigned to you, nearest deadline first.
        </p>
      </div>

      <MyTasksScreen
        initial={{
          ...result,
          now: result.now.toISOString(),
          buckets: Object.fromEntries(
            Object.entries(result.buckets).map(([name, tasks]) => [
              name,
              tasks.map((task) => ({
                ...task,
                deadline: task.deadline.toISOString(),
                completedAt: task.completedAt?.toISOString() ?? null,
                dependency: task.dependency
                  ? { ...task.dependency, deadline: task.dependency.deadline.toISOString() }
                  : null,
              })),
            ]),
          ) as never,
        }}
      />
    </div>
  );
}
