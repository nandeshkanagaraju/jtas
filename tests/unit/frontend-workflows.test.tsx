/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ProblemDrawer } from '@/app/(app)/problems/components/problem-drawer';
import { ProblemsScreen } from '@/app/(app)/problems/components/problems-screen';
import { QuickNavigation } from '@/components/shared/quick-navigation';
import type { ProblemDto, ProblemInboxDto } from '@/lib/api/problems-client';

const { fetchProblems, resolveProblemRequest } = vi.hoisted(() => ({
  fetchProblems: vi.fn(),
  resolveProblemRequest: vi.fn(),
}));
vi.mock('@/lib/api/problems-client', () => ({
  fetchProblems,
  acknowledgeProblemRequest: vi.fn(),
  rejectProblemRequest: vi.fn(),
  resolveProblemRequest,
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const problem: ProblemDto = {
  id: 'problem-1',
  description: 'Material certificate is missing.',
  severity: 'BLOCKER',
  status: 'OPEN',
  raisedBy: { id: 'member-1', name: 'Quality member' },
  acknowledgedAt: null,
  mdActionNote: null,
  resolvedAt: null,
  createdAt: '2026-10-22T04:30:00.000Z',
  ageHours: 1,
  ageBucket: 'under2h',
  isStale: false,
  subtask: {
    id: 'task-1',
    title: 'Inspect the batch',
    deadline: '2026-10-23T10:30:00.000Z',
    status: 'PROBLEM',
    assignee: { id: 'member-1', name: 'Quality member', email: 'quality@example.com' },
    department: { id: 'quality', name: 'Quality', code: 'QUALITY' },
    job: { id: 'job-1', jobCode: 'JGE-2026-0001', title: 'Bearing cap', partNumber: 'BC-01' },
  },
};
const inbox: ProblemInboxDto = {
  data: [problem],
  counts: { open: 1, acknowledged: 0, stale: 0, blockers: 1 },
};

beforeEach(() => {
  fetchProblems.mockReset();
  fetchProblems.mockResolvedValue(inbox);
  resolveProblemRequest.mockReset();
  resolveProblemRequest.mockResolvedValue({});
});
afterEach(cleanup);

describe('redesigned navigation and decision workflows', () => {
  it('opens the report named by a dashboard deep link', async () => {
    render(
      <ProblemsScreen initial={inbox} departments={[]} candidates={[]} initialOpenId="problem-1" />,
    );
    const drawer = await screen.findByRole('dialog');
    expect(within(drawer).getByText(problem.description).textContent).toBe(problem.description);
    expect(within(drawer).getByRole('button', { name: 'Mark as seen' })).toBeTruthy();
  });

  it('shows a recorded decision without offering another resolution', async () => {
    const closed = {
      ...problem,
      status: 'RESOLVED' as const,
      mdActionNote: '[RESUME] Certificate verified.',
      resolvedAt: '2026-10-22T05:30:00.000Z',
    };
    const initial = { ...inbox, data: [closed] };
    fetchProblems.mockResolvedValue(initial);
    render(
      <ProblemsScreen
        initial={initial}
        departments={[]}
        candidates={[]}
        initialOpenId="problem-1"
      />,
    );
    const drawer = await screen.findByRole('dialog');
    expect(within(drawer).getByText('[RESUME] Certificate verified.')).toBeTruthy();
    expect(within(drawer).queryByRole('button', { name: 'Resolve' })).toBeNull();
    expect(within(drawer).queryByRole('button', { name: 'Send it back' })).toBeNull();
  });

  it('reports a failed refresh instead of presenting an empty decision queue', async () => {
    fetchProblems.mockRejectedValue(new Error('Offline'));
    render(<ProblemsScreen initial={{ ...inbox, data: [] }} departments={[]} candidates={[]} />);
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('Could not load the inbox'),
    );
    expect(screen.queryByText('Nothing waiting on you')).toBeNull();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });

  it('advances only after the resolution is saved successfully', async () => {
    const onNext = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <ProblemDrawer
        problem={problem}
        open
        onOpenChange={onOpenChange}
        departments={[]}
        candidates={[]}
        onResolved={vi.fn()}
        onNext={onNext}
        queuePosition={1}
        queueTotal={2}
      />,
    );
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'Certificate verified. Continue inspection.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Resolve and next' }));
    await waitFor(() => expect(onNext).toHaveBeenCalledOnce());
    expect(resolveProblemRequest).toHaveBeenCalledWith('problem-1', {
      action: 'RESUME',
      mdActionNote: 'Certificate verified. Continue inspection.',
    });
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('keeps the decision and the current report when resolution fails', async () => {
    resolveProblemRequest.mockRejectedValue(new Error('Offline'));
    const onNext = vi.fn();
    render(
      <ProblemDrawer
        problem={problem}
        open
        onOpenChange={vi.fn()}
        departments={[]}
        candidates={[]}
        onResolved={vi.fn()}
        onNext={onNext}
      />,
    );
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Certificate verified.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Resolve and next' }));
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('Could not reach the server'),
    );
    expect(onNext).not.toHaveBeenCalled();
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe(
      'Certificate verified.',
    );
  });

  it('searches only the pages granted to the current account', () => {
    render(
      <QuickNavigation items={[{ href: '/my-tasks', label: 'My tasks', icon: 'my-tasks' }]} />,
    );
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('link', { name: 'My tasks' }).getAttribute('href')).toBe(
      '/my-tasks',
    );
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Search pages' }), {
      target: { value: 'Users' },
    });
    expect(within(dialog).queryByRole('link')).toBeNull();
    expect(within(dialog).getByText(/No page matches/)).toBeTruthy();
  });
});
