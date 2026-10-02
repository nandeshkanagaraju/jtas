/**
 * @vitest-environment jsdom
 */
import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { PlanWizard } from '@/app/(app)/jobs/[id]/plan/plan-wizard';
import { SubtaskBuilder, type SubtaskRowDraft } from '@/app/(app)/jobs/components/subtask-builder';
import { IstDateTimePicker } from '@/components/shared/ist-datetime-picker';
import { reminderConfirmation } from '@/lib/domain/reminder-lead';
import { formatIST, fromISTInput } from '@/lib/utils/time';
import { subtaskDraftSchema } from '@/lib/validation/subtask';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

const DEADLINE = '2026-10-02T10:30';

function completeRow(reminderLeadMinutes: number): SubtaskRowDraft {
  return {
    key: 'row-1',
    departmentId: 'dept',
    assigneeId: 'user',
    title: 'Bearing cap',
    deadline: DEADLINE,
    reminderLeadMinutes,
    requiresApproval: false,
    dependsOnKey: null,
  };
}

function DeadlineField() {
  const [value, setValue] = useState('2026-09-30T18:00');
  return <IstDateTimePicker value={value} onChange={setValue} />;
}

function LeadField() {
  const [rows, setRows] = useState<SubtaskRowDraft[]>([completeRow(360)]);

  return (
    <>
      <SubtaskBuilder
        rows={rows}
        onChange={setRows}
        departments={[]}
        users={[]}
        jobDeadline="2026-10-02T18:00"
        onApplyTemplate={() => undefined}
        templateName={null}
      />
      <output aria-label="Stored lead">{rows[0].reminderLeadMinutes}</output>
    </>
  );
}

function storedLead(): number {
  return Number(screen.getByLabelText('Stored lead').textContent);
}

function expectLineMatchesStoredLead() {
  const minutes = storedLead();
  expect(screen.getByText(reminderConfirmation(minutes, fromISTInput(DEADLINE)))).toBeTruthy();
}

describe('deadline entry', () => {
  it('accepts 9:07 PM, stores it as UTC, and shows 9:07 PM IST again', () => {
    render(<DeadlineField />);
    const time = screen.getByLabelText('Time (IST)') as HTMLInputElement;

    fireEvent.change(time, { target: { value: '21:07' } });

    expect(time.value).toBe('21:07');

    const wall = '2026-09-30T21:07';
    const stored = fromISTInput(wall);

    // 21:07 IST is 15:37 UTC. The picker value is that wall clock, not an offset.
    expect(stored.toISOString()).toBe('2026-09-30T15:37:00.000Z');
    expect(formatIST(stored, 'h:mm a')).toBe('9:07 PM');
    expect(formatIST(stored, "yyyy-MM-dd'T'HH:mm")).toBe(wall);
  });

  it('stores 6 hours as 360 minutes and says when the reminder fires', () => {
    render(<LeadField />);

    expect((screen.getByLabelText('Reminder amount') as HTMLInputElement).value).toBe('6');
    expect((screen.getByLabelText('Reminder unit') as HTMLSelectElement).value).toBe('hours');
    expect(storedLead()).toBe(360);
    expectLineMatchesStoredLead();
    expect(
      screen.getByText('Reminder 6 hours before the deadline — 02 Oct 2026, 04:30 AM'),
    ).toBeTruthy();

    const parsed = subtaskDraftSchema.parse({
      departmentId: 'dept',
      assigneeId: 'user',
      title: 'Bearing cap',
      deadline: DEADLINE,
      reminderLeadMinutes: storedLead(),
    });
    expect(parsed.reminderLeadMinutes).toBe(360);
  });

  it('stores 15 minutes as 15 and the confirmation uses that same value', () => {
    render(<LeadField />);

    fireEvent.change(screen.getByLabelText('Reminder unit'), { target: { value: 'minutes' } });
    fireEvent.change(screen.getByLabelText('Reminder amount'), { target: { value: '15' } });

    expect(storedLead()).toBe(15);
    expectLineMatchesStoredLead();
    expect(
      screen.getByText('Reminder 15 minutes before the deadline — 02 Oct 2026, 10:15 AM'),
    ).toBeTruthy();
  });

  it('refuses 0.25 and will not open step 3', () => {
    render(
      <PlanWizard
        job={{
          id: 'job-1',
          jobCode: 'JGE-2026-0004',
          title: 'Bearing cap',
          overallDeadline: '2026-10-02T18:00',
        }}
        departments={[]}
        templates={[]}
        users={[]}
        initialRows={[completeRow(360)]}
      />,
    );

    const review = () => screen.getByRole('button', { name: /Review/ }) as HTMLButtonElement;
    expect(review().disabled).toBe(false);

    fireEvent.change(screen.getByLabelText('Reminder amount'), { target: { value: '0.25' } });

    expect(screen.getByText('Enter a whole number.')).toBeTruthy();
    expect(review().disabled).toBe(true);
    fireEvent.click(review());
    expect(screen.queryByText('Review the chain')).toBeNull();
    expect(screen.getByText(/Step 2 of 3/)).toBeTruthy();
  });
});
