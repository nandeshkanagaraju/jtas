'use client';

import { useState } from 'react';
import { toast } from 'sonner';

import { IstDateTimePicker } from '@/components/shared/ist-datetime-picker';
import { Button } from '@/components/ui/button';
import { Panel } from '@/components/shared/panel';
import { Label } from '@/components/ui/label';
import { ApiError } from '@/lib/api/client';
import { commitSubtaskDeadlineRequest } from '@/lib/api/subtasks-client';
import { deadlineLabel } from '@/lib/utils/relative-time';
import { formatIST } from '@/lib/utils/time';

/**
 * The first thing a member sees when their turn has arrived and the task has
 * no date. The date they commit becomes the deadline, and they cannot edit it.
 */
export function CommitmentPanel({
  subtaskId,
  jobCode,
  jobTitle,
  departmentName,
  commitmentDueAt,
  onCommitted,
  onReportProblem,
}: {
  subtaskId: string;
  jobCode: string;
  jobTitle: string;
  departmentName: string;
  commitmentDueAt: string;
  onCommitted: () => void;
  onReportProblem: () => void;
}) {
  const [deadline, setDeadline] = useState('');
  const [busy, setBusy] = useState(false);

  const due = new Date(commitmentDueAt);
  const label = deadlineLabel(due);
  const windowText = label.overdue
    ? `The 24 hours ended ${label.text}. Commit a date, or report why you cannot.`
    : `${label.text} to commit a finish date.`;

  async function commit() {
    setBusy(true);
    try {
      await commitSubtaskDeadlineRequest(subtaskId, { deadline });
      toast.success('Date committed. It is fixed — ask the MD if it needs to move.');
      onCommitted();
    } catch (error) {
      toast.error(
        error instanceof ApiError ? error.message : 'Could not reach the server. Try again.',
      );
    } finally {
      setBusy(false);
    }
  }

  /*
   * The loudest thing on the member's screen, because it is the only one with
   * a window that closes: the border takes the late tone once the 24 hours are
   * gone, and the deadline carries the word as well as the colour.
   */
  return (
    <Panel
      id="commitment-panel"
      className={label.overdue ? 'border-late' : 'border-primary'}
      title="Commit a finish date"
      description={
        <>
          <span className="code">{jobCode}</span> · {departmentName} · {jobTitle}
        </>
      }
      bodyClassName="p-4 space-y-4"
    >
      <p className={label.overdue ? 'text-late text-base font-medium' : 'text-base'}>
        Commit by <span className="code font-medium">{formatIST(due)}</span>. {windowText}
      </p>

      <div className="space-y-1.5">
        <Label htmlFor="commit-deadline">This becomes the deadline</Label>
        <IstDateTimePicker id="commit-deadline" value={deadline} onChange={setDeadline} />
        <p className="text-muted-foreground text-xs">
          Once committed you cannot move it yourself — you can ask the MD for more time.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          className="min-h-11 text-base"
          disabled={busy || deadline === ''}
          onClick={() => void commit()}
        >
          Commit this date
        </Button>
        <Button
          variant="outline"
          className="min-h-11 text-base"
          disabled={busy}
          onClick={onReportProblem}
        >
          Report problem
        </Button>
      </div>
    </Panel>
  );
}
