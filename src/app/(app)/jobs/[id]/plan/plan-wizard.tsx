'use client';

import { ArrowLeft, Loader2, Send, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import {
  SubtaskBuilder,
  rowProblems,
  type SubtaskRowDraft,
} from '@/app/(app)/jobs/components/subtask-builder';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
}: {
  job: JobHeader;
  departments: DepartmentSummary[];
  templates: TemplateSummary[];
  users: UserRow[];
}) {
  const router = useRouter();
  const [rows, setRows] = useState<SubtaskRowDraft[]>([]);
  const [step, setStep] = useState<2 | 3>(2);
  const [overrideReason, setOverrideReason] = useState('');
  const [error, setError] = useState<string | null>(null);
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
      scheduled.map(({ item, deadline }) => {
        const candidate = users.find(
          (user) =>
            user.departmentId === item.department.id && user.isActive && user.role !== 'ADMIN',
        );

        return {
          key: keyByOrder.get(item.order)!,
          departmentId: item.department.id,
          assigneeId: candidate?.id ?? '',
          title: item.title,
          deadline,
          reminderLeadHours: Math.round(item.reminderLeadMinutes / 60),
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

  const incomplete = rows.filter((row) => rowProblems(row).length > 0);
  const late = rows.filter((row) => row.deadline !== '' && row.deadline > job.overallDeadline);
  const canContinue = rows.length > 0 && incomplete.length === 0;

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
          deadline: row.deadline,
          reminderLeadMinutes: Math.round(row.reminderLeadHours * 60),
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
      setError(caught instanceof ApiError ? caught.message : 'Could not reach the server.');
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="space-y-3">
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link href={`/jobs/${job.id}`}>
            <ArrowLeft className="size-4" />
            Back to the job
          </Link>
        </Button>

        <div className="space-y-1">
          <p className="tabular text-muted-foreground text-sm">{job.jobCode}</p>
          <h1 className="text-2xl font-semibold tracking-tight">{job.title}</h1>
          <p className="text-muted-foreground text-sm">
            Step {step} of 3 ·{' '}
            {step === 2 ? 'Break the job into department subtasks' : 'Review and publish'}
          </p>
        </div>
      </div>

      {error ? (
        <Alert variant="destructive" role="alert">
          <AlertTitle>That did not work</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {step === 2 ? (
        <>
          <Card>
            <CardContent className="pt-6">
              <SubtaskBuilder
                rows={rows}
                onChange={setRows}
                departments={departments}
                users={users}
                jobDeadline={job.overallDeadline}
                onApplyTemplate={applyTemplate}
                templateName={template?.name ?? null}
              />
            </CardContent>
          </Card>

          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => router.push(`/jobs/${job.id}`)}>
              Save and finish later
            </Button>
            <Button disabled={!canContinue} onClick={() => setStep(3)}>
              Review ({rows.length})
            </Button>
          </div>
        </>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Review the chain</CardTitle>
              <CardDescription>
                This is what publishing will start. Everything with a predecessor waits for it.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <PlanReview rows={rows} departments={departments} users={users} />
            </CardContent>
          </Card>

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
