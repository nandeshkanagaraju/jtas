/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  PhoneAppProvider,
  PhoneDisclosure,
  PhoneQueue,
  usePhoneApp,
} from '@/components/shared/phone-app';
import { TaskCard } from '@/app/(app)/my-tasks/components/task-card';
import type { MyTaskDto } from '@/lib/api/my-tasks-client';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
function mode(installed: boolean, width: number) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('max-width')
      ? width <= 1023
      : query.includes('standalone') && installed,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
}
function Probe() {
  const phone = usePhoneApp();
  return <p>{phone ? 'Phone app' : 'Browser layout'}</p>;
}

describe('installed phone presentation', () => {
  it.each([
    [false, 390, false],
    [true, 390, true],
    [true, 1440, false],
  ])('selects the correct layout: installed %s, width %s', (installed, width, phone) => {
    mode(Boolean(installed), Number(width));
    render(
      <PhoneAppProvider>
        <Probe />
        <PhoneDisclosure title="Extra information">
          <p>Full detail</p>
        </PhoneDisclosure>
      </PhoneAppProvider>,
    );
    expect(screen.getByText(phone ? 'Phone app' : 'Browser layout')).toBeTruthy();
    expect(Boolean(screen.queryByText('Extra information'))).toBe(phone);
    expect(screen.getByText('Full detail')).toBeTruthy();
  });
  it('keeps every queued item available behind Show all', () => {
    mode(true, 390);
    render(
      <PhoneAppProvider>
        <PhoneQueue>
          {[1, 2, 3, 4, 5].map((i) => (
            <li key={i}>Item {i}</li>
          ))}
        </PhoneQueue>
      </PhoneAppProvider>,
    );
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    fireEvent.click(screen.getByRole('button', { name: 'Show all 5 items' }));
    expect(screen.getAllByRole('listitem')).toHaveLength(5);
    fireEvent.click(screen.getByRole('button', { name: 'Show fewer items' }));
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
  });
  it('does not shorten queues in the web layout', () => {
    mode(false, 390);
    render(
      <PhoneAppProvider>
        <PhoneQueue>
          {[1, 2, 3, 4, 5].map((i) => (
            <li key={i}>Item {i}</li>
          ))}
        </PhoneQueue>
      </PhoneAppProvider>,
    );
    expect(screen.getAllByRole('listitem')).toHaveLength(5);
  });
});

const task: MyTaskDto = {
  id: 'task-1',
  jobId: 'job-1',
  jobCode: 'JGE-2026-0001',
  jobTitle: 'Spindle batch',
  partNumber: 'SH-4410',
  department: { id: 'production', name: 'Production', code: 'PRD' },
  title: 'Machine the first batch',
  deadline: '2027-06-15T12:30:00Z',
  commitmentDueAt: null,
  status: 'PENDING',
  hoursRemaining: 24,
  requiresApproval: false,
  dependency: null,
  hasOpenProblem: false,
  completedAt: null,
};
describe('compact task actions', () => {
  it('preserves starting, completing and opening a problem report', () => {
    mode(true, 390);
    const onAction = vi.fn();
    render(
      <PhoneAppProvider>
        <TaskCard task={task} section="dueToday" busy={false} onAction={onAction} />
      </PhoneAppProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Start work' }));
    expect(onAction).toHaveBeenLastCalledWith('START');
    fireEvent.click(screen.getByRole('button', { name: 'Mark completed' }));
    expect(onAction).toHaveBeenLastCalledWith('COMPLETE');
    fireEvent.click(screen.getByRole('button', { name: 'Report problem' }));
    expect(screen.queryByRole('button', { name: 'Start work' })).toBeNull();
    expect(within(screen.getByRole('article')).getByRole('textbox')).toBeTruthy();
  });
  it('keeps blocked work blocked in the compact card', () => {
    mode(true, 390);
    render(
      <PhoneAppProvider>
        <TaskCard
          task={{ ...task, status: 'BLOCKED' }}
          section="blocked"
          busy={false}
          onAction={vi.fn()}
        />
      </PhoneAppProvider>,
    );
    expect(screen.queryByRole('button', { name: 'Start work' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Mark completed' })).toBeNull();
  });
});
