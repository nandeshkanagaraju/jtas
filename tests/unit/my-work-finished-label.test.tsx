/** @vitest-environment jsdom */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DesktopTaskTable } from '@/app/(app)/my-tasks/components/task-table';
import type { MyTaskDto, MyTasksDto } from '@/lib/api/my-tasks-client';
import { BUCKET_ORDER } from '@/lib/domain/task-buckets';

afterEach(cleanup);

function done(id: string, deadline: string, completedAt: string): MyTaskDto {
  return {
    id,
    jobId: `job-${id}`,
    jobCode: `JGE-2026-000${id}`,
    jobTitle: 'Manifold block',
    partNumber: 'HMB-240',
    department: { id: 'd1', name: 'Production', code: 'PRODUCTION' },
    title: `Machine batch ${id}`,
    deadline,
    commitmentDueAt: null,
    status: 'COMPLETED',
    hoursRemaining: -120,
    requiresApproval: false,
    dependency: null,
    hasOpenProblem: false,
    completedAt,
  };
}

function data(tasks: MyTaskDto[]): MyTasksDto {
  const buckets = Object.fromEntries(
    BUCKET_ORDER.map((name) => [name, [] as MyTaskDto[]]),
  ) as MyTasksDto['buckets'];
  buckets.recentlyCompleted = tasks;
  return {
    buckets,
    summary: { overdue: 0, dueToday: 0, openProblems: 0, blocked: 0, awaitingApproval: 0 },
    now: '2026-11-25T04:00:00.000Z',
  } as MyTasksDto;
}

describe('My work: finished tasks', () => {
  it('measures a finished task against its deadline, not against today', () => {
    vi.setSystemTime(new Date('2026-11-25T04:00:00.000Z'));
    render(
      <DesktopTaskTable
        data={data([
          done('1', '2026-11-19T11:30:00.000Z', '2026-11-19T11:20:00.000Z'), // 10 min early
          done('2', '2026-11-19T11:30:00.000Z', '2026-11-21T11:30:00.000Z'), // 2 days late
        ])}
        busyId={null}
        onAction={() => {}}
      />,
    );
    expect(screen.getByText(/Finished 10 min(ute)?s? early/i)).toBeTruthy();
    expect(screen.getByText(/Finished 2 days late/i)).toBeTruthy();
    expect(screen.queryByText(/^\d+ days late$/)).toBeNull(); // the old "from today" label
    vi.useRealTimers();
  });
});
