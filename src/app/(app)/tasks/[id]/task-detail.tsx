'use client';

import { ArrowLeft, Check, Lock, Play, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { ProblemForm, type Severity } from '@/app/(app)/my-tasks/components/problem-form';
import { Countdown } from '@/components/shared/countdown';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import { ApiError } from '@/lib/api/client';
import type { ExtensionRequestDto } from '@/lib/api/my-tasks-client';
import { changeSubtaskStatusRequest, type SubtaskDto } from '@/lib/api/subtasks-client';
import { cn } from '@/lib/utils';
import { formatIST } from '@/lib/utils/time';

import { AttachmentPanel } from '@/components/collaboration/attachment-panel';
import { CommentThread } from '@/components/collaboration/comment-thread';

import { CommitmentPanel } from './commitment-panel';
import { ExtensionPanel } from './extension-panel';
import { TaskStatusAlerts } from './task-status-alerts';

export interface TaskPermissions {
  updateStatus: boolean;
  raiseProblem: boolean;
  requestExtension: boolean;
  /** M10: anyone on the job may ask a question here. */
  comment: boolean;
  /** M10: only the person accountable for the subtask puts files on it (FR-34). */
  attach: boolean;
}

export function TaskDetail({
  subtask,
  permissions,
  initialAction,
  extensionRequests,
  currentUserId,
}: {
  subtask: SubtaskDto;
  permissions: TaskPermissions;
  currentUserId: string;
  /** From the `?action=` deep link the M7 emails use (improvement I-14). */
  initialAction: 'complete' | 'problem' | null;
  extensionRequests: ExtensionRequestDto[];
}) {
  const router = useRouter();
  const [reporting, setReporting] = useState(initialAction === 'problem');
  const [completing, setCompleting] = useState(initialAction === 'complete');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const completeRef = useRef<HTMLTextAreaElement>(null);

  const blocked = subtask.status === 'BLOCKED';
  const done = subtask.status === 'COMPLETED';
  const cancelled = subtask.status === 'CANCELLED';
  const waiting = subtask.status === 'AWAITING_APPROVAL';
  /**
   * The three primary buttons stay on screen while blocked, disabled, with the
   * reason above them (build spec M5.3). Hiding them would leave the member
   * wondering whether the app is broken; showing them greyed says "this is
   * yours, it is just not your turn yet".
   */
  // A reported problem is the MD's to move; the state machine allows nothing
  // else out of PROBLEM, so the buttons would only fail.
  const reported = subtask.status === 'PROBLEM';
  const canAct = permissions.updateStatus && !done && !cancelled && !waiting && !reported;
  const owesCommitment =
    !blocked && !done && !cancelled && !subtask.deadline && !!subtask.commitmentDueAt;

  // Deep link from a reminder email lands with the right control already open
  // and focused, so the flow from mail to update really is two taps.
  useEffect(() => {
    if (initialAction === 'complete') completeRef.current?.focus();
  }, [initialAction]);

  async function act(
    action: 'START' | 'COMPLETE' | 'PROBLEM',
    payload?: { note: string; severity: Severity },
  ) {
    setBusy(true);
    try {
      const result = await changeSubtaskStatusRequest(subtask.id, {
        action,
        note: payload?.note ?? (action === 'COMPLETE' ? note.trim() || undefined : undefined),
        severity: payload?.severity,
      });

      toast.success(
        action === 'COMPLETE'
          ? subtask.requiresApproval
            ? 'Sent to the MD for approval.'
            : 'Marked completed.'
          : action === 'START'
            ? 'Started.'
            : 'The MD has been told.',
        result.unblocked.length > 0
          ? { description: `${result.unblocked.length} task is no longer blocked.` }
          : undefined,
      );

      setReporting(false);
      setCompleting(false);
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof ApiError ? error.message : 'Could not reach the server. Try again.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href="/my-tasks">
          <ArrowLeft className="size-4" />
          My tasks
        </Link>
      </Button>

      {owesCommitment && subtask.commitmentDueAt ? (
        <CommitmentPanel
          subtaskId={subtask.id}
          jobCode={subtask.jobCode}
          jobTitle={subtask.jobTitle}
          departmentName={subtask.department.name}
          commitmentDueAt={subtask.commitmentDueAt}
          onCommitted={() => router.refresh()}
          onReportProblem={() => setReporting(true)}
        />
      ) : null}

      {/* Everything needed to decide, above the buttons (SDD 7.2). */}
      <Card>
        <CardHeader>
          <CardDescription className="flex flex-wrap items-center gap-x-2 text-xs">
            <span className="tabular">{subtask.jobCode}</span>
            {subtask.partNumber ? <span>· {subtask.partNumber}</span> : null}
            <span>· {subtask.department.name}</span>
          </CardDescription>
          <CardTitle className="text-xl leading-snug">{subtask.title}</CardTitle>
          <CardDescription>{subtask.jobTitle}</CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span
              className={cn(
                'tabular text-lg font-semibold',
                subtask.isOverdue && 'text-state-overdue',
              )}
            >
              {subtask.deadline
                ? formatIST(new Date(subtask.deadline))
                : owesCommitment
                  ? 'Awaiting your commitment'
                  : 'No date yet'}
            </span>
            {subtask.deadline ? (
              <Countdown deadline={subtask.deadline} className="text-sm" />
            ) : null}
            {subtask.requiresApproval ? (
              <Badge variant="outline" className="gap-1">
                <Lock className="size-3" />
                MD approves
              </Badge>
            ) : null}
          </div>

          {subtask.description ? (
            <p className="text-muted-foreground text-sm whitespace-pre-wrap">
              {subtask.description}
            </p>
          ) : null}

          <TaskStatusAlerts subtask={subtask} readOnly={!permissions.updateStatus} />

          {canAct ? (
            <>
              <Separator />

              {reporting ? (
                <ProblemForm
                  busy={busy}
                  autoFocus
                  onCancel={() => setReporting(false)}
                  onSubmit={(payload) => act('PROBLEM', payload)}
                />
              ) : completing ? (
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <p className="text-sm font-medium">
                      Anything worth recording?{' '}
                      <span className="text-muted-foreground font-normal">(optional)</span>
                    </p>
                    <Textarea
                      ref={completeRef}
                      value={note}
                      onChange={(event) => setNote(event.target.value)}
                      rows={2}
                      maxLength={5000}
                      disabled={busy}
                      placeholder="Batch cleared, report filed…"
                    />
                  </div>
                  <div className="flex gap-2">
                    <Button
                      className="min-h-12 flex-1 text-base"
                      disabled={busy}
                      onClick={() => act('COMPLETE')}
                    >
                      <Check className="size-5" />
                      {subtask.requiresApproval ? 'Send for approval' : 'Mark completed'}
                    </Button>
                    <Button
                      variant="ghost"
                      className="min-h-12"
                      onClick={() => setCompleting(false)}
                      disabled={busy}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                /* The three large primary buttons of SDD 7.2, 48px tall. */
                <div className="grid gap-2 sm:grid-cols-3">
                  <Button
                    variant="outline"
                    className="min-h-12 text-base"
                    disabled={busy || blocked || subtask.status !== 'PENDING'}
                    title={
                      blocked
                        ? `Waiting for ${subtask.dependsOn?.title ?? 'another task'} to be finished.`
                        : undefined
                    }
                    onClick={() => act('START')}
                  >
                    <Play className="size-5" />
                    Start work
                  </Button>

                  <Button
                    className="min-h-12 text-base"
                    disabled={busy || blocked}
                    title={blocked ? 'You can finish this once the task above is done.' : undefined}
                    onClick={() => setCompleting(true)}
                  >
                    <Check className="size-5" />
                    Mark completed
                  </Button>

                  <Button
                    variant="outline"
                    className="min-h-12 text-base"
                    disabled={
                      busy || blocked || !permissions.raiseProblem || subtask.status === 'PROBLEM'
                    }
                    title={
                      blocked
                        ? 'Report a problem once the work is actually yours to do.'
                        : undefined
                    }
                    onClick={() => setReporting(true)}
                  >
                    <TriangleAlert className="size-5" />
                    Report problem
                  </Button>
                </div>
              )}
            </>
          ) : null}

          {blocked && permissions.updateStatus ? (
            <p className="text-muted-foreground text-xs">
              These stay unavailable until{' '}
              {subtask.dependsOn ? `“${subtask.dependsOn.title}”` : 'the task above'} is finished.
            </p>
          ) : null}
        </CardContent>
      </Card>

      {permissions.requestExtension && subtask.deadline && !done && !cancelled ? (
        <ExtensionPanel
          subtaskId={subtask.id}
          currentDeadline={subtask.deadline}
          requests={extensionRequests}
          onChanged={() => router.refresh()}
        />
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Comments and files</CardTitle>
          <CardDescription>
            Drawings, inspection reports and the back-and-forth on this task.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <AttachmentPanel
            jobId={subtask.jobId}
            subtaskId={subtask.id}
            canUpload={permissions.attach}
            canDelete={permissions.attach}
          />

          <CommentThread
            subtaskId={subtask.id}
            currentUserId={currentUserId}
            canComment={permissions.comment}
          />
        </CardContent>
      </Card>
    </div>
  );
}
