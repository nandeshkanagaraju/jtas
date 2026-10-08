'use client';

import { Loader2, Send, TriangleAlert } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import {
  SubtaskBuilder,
  canReviewRows,
  type SubtaskRowDraft,
} from '@/app/(app)/jobs/components/subtask-builder';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/shared/page-header';
import { Panel } from '@/components/shared/panel';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ApiError } from '@/lib/api/client';
import { publishJobRequest } from '@/lib/api/jobs-client';
import { bulkCreateSubtasksRequest } from '@/lib/api/subtasks-client';
import type { UserRow } from '@/lib/api/users-client';
import { scheduleFromTemplate } from '@/lib/domain/template-schedule';
import type { DepartmentSummary } from '@/lib/services/department-service';
import type { TemplateSummary } from '@/lib/services/job-template-service';
import { fromISTInput } from '@/lib/utils/time';

import { PlanReview } from './plan-review';

/**
 * A publish failure names the field, and a step-2 field can be focused again.
 *
 * Step 3 has nothing to highlight, so the generic "correct the highlighted
 * fields" sentence is replaced with the server's own reason.
 */
function describePublishError(caught: unknown): { message: string; focusId: string | null } {
  if (!(caught instanceof ApiError)) {
    return { message: 'Could not reach the server.', focusId: null };
  }

  const fields = caught.fields ?? {};
  const entry = Object.entries(fields).find(([, messages]) => messages.length > 0);
  if (!entry) return { message: caught.message, focusId: null };

  const [path, messages] = entry;
  const match = /^subtasks\.(\d+)\.(\w+)/.exec(path);
  if (!match) return { message: messages[0], focusId: null };

  const index = match[1];
  const field = match[2];
  const focusId =
    field === 'reminderLeadMinutes'
      ? `reminder-lead-${index}`
      : field === 'deadline'
        ? `subtask-deadline-${index}`
        : null;

  return { message: messages[0], focusId };
}

interface JobHeader {
  id: string;
  jobCode: string;
  title: string;
  overallDeadline: string;
}

export function PlanWizard({
  job,
  departments,
  templates,
  users,
  initialRows = [],
}: {
  job: JobHeader;
  departments: DepartmentSummary[];
  templates: TemplateSummary[];
  users: UserRow[];
  /** A chain already on screen. The plan page starts empty. */
  initialRows?: SubtaskRowDraft[];
}) {
  const router = useRouter();
  const [rows, setRows] = useState<SubtaskRowDraft[]>(initialRows);
  const [step, setStep] = useState<2 | 3>(2);
  const [overrideReason, setOverrideReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [errorFocusId, setErrorFocusId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const template = templates[0] ?? null;

  /**
   * Prefills the builder from the template (FR-11).
   *
   * Deadlines are `jobDeadline − offsetHoursBeforeDue`, so the whole chain
   * compresses or stretches with the due date. Each item's assignee defaults to
   * the first active member of its department, which is right most of the time
   * and obvious to change when it is not.
   */
  function applyTemplate() {
    if (!template) return;

    const scheduled = scheduleFromTemplate(template.items, fromISTInput(job.overallDeadline));
    const keyByOrder = new Map(template.items.map((item) => [item.order, `tpl-${item.order}`]));

    setRows(
      scheduled.map(({ item }) => {
        const candidate = users.find(
          (user) =>
            user.departmentId === item.department.id && user.isActive && user.role !== 'ADMIN',
        );

        return {
          key: keyByOrder.get(item.order)!,
          departmentId: item.department.id,
          assigneeId: candidate?.id ?? '',
          title: item.title,
          deadline: '',
          reminderLeadMinutes: item.reminderLeadMinutes,
          requiresApproval: false,
          // `!= null`, not truthiness: order 0 is the first step of the
          // template, and a step that waits for it would otherwise be applied
          // with no predecessor at all — published as actionable on day one
          // instead of BLOCKED, which is the whole point of the chain.
          dependsOnKey:
            item.dependsOnItemOrder != null
              ? (keyByOrder.get(item.dependsOnItemOrder) ?? null)
              : null,
        };
      }),
    );
  }

  const late = rows.filter((row) => row.deadline !== '' && row.deadline > job.overallDeadline);
  const canContinue = canReviewRows(rows);

  useEffect(() => {
    if (!errorFocusId || step !== 2) return;
    document.getElementById(errorFocusId)?.focus();
  }, [errorFocusId, step]);

  async function saveAndPublish() {
    setBusy(true);
    setError(null);

    try {
      await bulkCreateSubtasksRequest(job.id, {
        subtasks: rows.map((row) => ({
          key: row.key,
          departmentId: row.departmentId,
          assigneeId: row.assigneeId,
          title: row.title,
          ...(row.deadline ? { deadline: row.deadline } : {}),
          reminderLeadMinutes: row.reminderLeadMinutes,
          requiresApproval: row.requiresApproval,
          dependsOnKey: row.dependsOnKey,
          // FR-23: the server refuses a late deadline until a reason is given.
          deadlineOverrideReason: overrideReason || undefined,
          assigneeOverrideReason: overrideReason || undefined,
        })),
      });

      await publishJobRequest(job.id);
      router.push(`/jobs/${job.id}`);
    } catch (caught) {
      const described = describePublishError(caught);
      setError(described.message);
      setErrorFocusId(described.focusId);
      if (described.focusId) setStep(2);
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader
        back={{ href: `/jobs/${job.id}`, label: 'Back to the job' }}
        eyebrow={`${job.jobCode} · Step ${step} of 3`}
        title={job.title}
        lead={step === 2 ? 'Break the job into department subtasks' : 'Review and publish'}
      />

      {error ? (
        <Alert variant="destructive" role="alert">
          <AlertTitle>That did not work</AlertTitle>
          <AlertDescription>
            {errorFocusId ? (
              <button
                type="button"
                className="text-left underline underline-offset-2"
                onClick={() => {
                  setStep(2);
                  document.getElementById(errorFocusId)?.focus();
                }}
              >
                {error}
              </button>
            ) : (
              error
            )}
          </AlertDescription>
        </Alert>
      ) : null}

      {step === 2 ? (
        <>
          <Panel
            title="Department subtasks"
            description="One step per department, in shop-flow order. Each deadline is measured backwards from the job’s."
          >
            <SubtaskBuilder
              rows={rows}
              onChange={setRows}
              departments={departments}
              users={users}
              jobDeadline={job.overallDeadline}
              onApplyTemplate={applyTemplate}
              templateName={template?.name ?? null}
            />
          </Panel>

          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => router.push(`/jobs/${job.id}`)}>
              Save and finish later
            </Button>
            <Button
              disabled={!canContinue}
              onClick={() => {
                if (!canReviewRows(rows)) return;
                setError(null);
                setErrorFocusId(null);
                setStep(3);
              }}
            >
              Review ({rows.length})
            </Button>
          </div>
        </>
      ) : (
        <>
          <Panel
            title="Review the chain"
            description="This is what publishing will start. Everything with a predecessor waits for it."
          >
            <PlanReview rows={rows} departments={departments} users={users} />
          </Panel>

          {late.length > 0 ? (
            <Alert variant="destructive">
              <TriangleAlert className="size-4" />
              <AlertTitle>
                {late.length} {late.length === 1 ? 'subtask runs' : 'subtasks run'} past the job
                deadline
              </AlertTitle>
              <AlertDescription className="space-y-2">
                <p>
                  {late.map((row) => row.title || 'Untitled').join(', ')} finish after the job is
                  due. Say why, and it goes on the record.
                </p>
                <div className="w-full space-y-1.5">
                  <Label htmlFor="override" className="text-xs">
                    Reason
                  </Label>
                  <Textarea
                    id="override"
                    value={overrideReason}
                    onChange={(event) => setOverrideReason(event.target.value)}
                    rows={2}
                    maxLength={500}
                  />
                </div>
              </AlertDescription>
            </Alert>
          ) : null}

          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setStep(2)} disabled={busy}>
              Back
            </Button>
            <Button
              onClick={saveAndPublish}
              disabled={busy || (late.length > 0 && overrideReason.trim().length < 5)}
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
              Publish job
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
