'use client';

import { useState } from 'react';
import { toast } from 'sonner';

import { IstDateTimePicker } from '@/components/shared/ist-datetime-picker';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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

  return (
    <Card className="border-primary/40">
      <CardHeader>
        <CardDescription className="text-xs">
          <span className="tabular">{jobCode}</span>
          <span> · {departmentName}</span>
        </CardDescription>
        <CardTitle className="text-xl">Commit a finish date</CardTitle>
        <CardDescription>
          {jobTitle}. Commit a finish date by {formatIST(due)}. {windowText}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="commit-deadline">This becomes the deadline</Label>
          <IstDateTimePicker id="commit-deadline" value={deadline} onChange={setDeadline} />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button disabled={busy || deadline === ''} onClick={() => void commit()}>
            Commit this date
          </Button>
          <Button variant="outline" disabled={busy} onClick={onReportProblem}>
            Report problem
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
