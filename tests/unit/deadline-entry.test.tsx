/**
 * @vitest-environment jsdom
 */
import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { SubtaskBuilder, type SubtaskRowDraft } from '@/app/(app)/jobs/components/subtask-builder';
import { IstDateTimePicker } from '@/components/shared/ist-datetime-picker';
import { formatIST, fromISTInput } from '@/lib/utils/time';
import { subtaskDraftSchema } from '@/lib/validation/subtask';

function DeadlineField() {
  const [value, setValue] = useState('2026-09-30T18:00');
  return <IstDateTimePicker value={value} onChange={setValue} />;
}

function LeadField() {
  const [rows, setRows] = useState<SubtaskRowDraft[]>([
    {
      key: 'row-1',
      departmentId: '',
      assigneeId: '',
      title: 'Bearing cap',
      deadline: '2026-09-30T21:07',
      reminderLeadMinutes: 360,
      requiresApproval: false,
      dependsOnKey: null,
    },
  ]);

  return (
    <SubtaskBuilder
      rows={rows}
      onChange={setRows}
      departments={[]}
      users={[]}
      jobDeadline="2026-09-30T22:00"
      onApplyTemplate={() => undefined}
      templateName={null}
    />
  );
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

  it('keeps a 15-minute reminder lead as 15 minutes', () => {
    render(<LeadField />);
    const lead = screen.getByLabelText('Remind minutes before') as HTMLInputElement;

    fireEvent.change(lead, { target: { value: '15' } });

    expect(lead.value).toBe('15');

    const parsed = subtaskDraftSchema.parse({
      departmentId: 'dept',
      assigneeId: 'user',
      title: 'Bearing cap',
      deadline: '2026-09-30T21:07',
      reminderLeadMinutes: Number(lead.value),
    });

    expect(parsed.reminderLeadMinutes).toBe(15);
  });
});
