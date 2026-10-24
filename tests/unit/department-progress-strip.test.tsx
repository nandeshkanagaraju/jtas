/** @vitest-environment jsdom */
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DepartmentProgressStrip } from '@/app/(app)/updates/department-progress-strip';
import { LanguageProvider } from '@/lib/i18n/provider';
import type { LiveStage } from '@/lib/live-updates/types';

const mode = vi.hoisted(() => ({ phone: true }));
vi.mock('@/components/shared/phone-app', () => ({ usePhoneApp: () => mode.phone }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
afterEach(() => {
  cleanup();
  mode.phone = true;
});

function stage(id: string, name: string, status: string, dependsOnId: string | null): LiveStage {
  return {
    id,
    title: `${name} work`,
    department: { id, name, code: name.toUpperCase(), sequenceOrder: 1 },
    assignee: { id, name: `${name} member` },
    status,
    deadline: null,
    commitmentDueAt: null,
    completedAt: null,
    dependsOnId,
    isOverdue: false,
    current: status === 'IN_PROGRESS',
    problem: null,
    canComment: false,
  };
}
const stages = [
  stage('planning', 'Planning', 'BLOCKED', 'production'),
  stage('purchase', 'Purchase', 'BLOCKED', 'planning'),
  stage('production', 'Production', 'IN_PROGRESS', null),
];

describe('phone department overview', () => {
  it('follows the saved dependencies rather than department display order', () => {
    render(<DepartmentProgressStrip stages={stages} jobStatus="IN_PROGRESS" />);
    const route = screen.getByRole('list', { name: 'Department route' });
    expect(
      within(route)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['PRDProduction: In progress', 'PLNPlanning: Waiting', 'PURPurchase: Waiting']);
    expect(screen.getByText('Next after Production:')).toBeTruthy();
    expect(screen.queryByText('Next after Planning:')).toBeNull();
    expect(screen.getByText('Production member')).toBeTruthy();
  });

  it('updates the current and next department after a handoff', () => {
    const view = render(<DepartmentProgressStrip stages={stages} jobStatus="IN_PROGRESS" />);
    view.rerender(
      <DepartmentProgressStrip
        stages={stages.map((row) =>
          row.id === 'production'
            ? { ...row, status: 'COMPLETED', current: false }
            : row.id === 'planning'
              ? { ...row, status: 'PENDING', current: true }
              : row,
        )}
        jobStatus="IN_PROGRESS"
      />,
    );
    expect(screen.getByText('1 of 3 tasks complete')).toBeTruthy();
    expect(screen.getByText('Next after Planning:')).toBeTruthy();
    expect(screen.getByText('Planning member')).toBeTruthy();
    expect(screen.queryByText('Production member')).toBeNull();
  });

  it('preserves parallel active work without inventing a handoff between it', () => {
    render(
      <DepartmentProgressStrip
        stages={[
          stage('production', 'Production', 'IN_PROGRESS', null),
          stage('planning', 'Planning', 'IN_PROGRESS', null),
        ]}
        jobStatus="IN_PROGRESS"
      />,
    );
    expect(screen.getAllByText('Current stage:')).toHaveLength(2);
    expect(screen.queryByText(/Next after/)).toBeNull();
  });

  it.each(['DRAFT', 'ON_HOLD', 'CANCELLED', 'COMPLETED'])(
    'shows no active department or future handoff for a %s job',
    (jobStatus) => {
      render(<DepartmentProgressStrip stages={stages} jobStatus={jobStatus} />);
      expect(screen.queryByText('Current stage:')).toBeNull();
      expect(screen.queryByText(/Next after/)).toBeNull();
      expect(document.querySelector('[aria-current="step"]')).toBeNull();
    },
  );

  it('does not invent missing departments or a handoff for waiting work', () => {
    render(<DepartmentProgressStrip stages={[stages[0]]} jobStatus="IN_PROGRESS" />);
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    expect(screen.getByText('No active department')).toBeTruthy();
    expect(screen.queryByText(/Next after/)).toBeNull();
  });

  it.each(['ta', 'hi'] as const)(
    'translates status, department and handoff text in %s',
    (locale) => {
      render(
        <LanguageProvider initialLocale={locale}>
          <DepartmentProgressStrip stages={stages} jobStatus="IN_PROGRESS" />
        </LanguageProvider>,
      );
      expect(screen.queryByText('Current stage:')).toBeNull();
      expect(screen.queryByText('Next after Production:')).toBeNull();
      expect(screen.getByText('Production member')).toBeTruthy();
      expect(screen.getByText('PRD')).toBeTruthy();
    },
  );

  it('leaves the desktop and browser layout unchanged', () => {
    mode.phone = false;
    const { container } = render(
      <DepartmentProgressStrip stages={stages} jobStatus="IN_PROGRESS" />,
    );
    expect(container.innerHTML).toBe('');
  });
});
