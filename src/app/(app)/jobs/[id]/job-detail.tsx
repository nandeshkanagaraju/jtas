'use client';

import { ArrowLeft, History, ListTodo } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { JobForm } from '@/app/(app)/jobs/components/job-form';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ApiError } from '@/lib/api/client';
import {
  cancelJobRequest,
  holdJobRequest,
  publishJobRequest,
  unholdJobRequest,
  updateJobRequest,
  type JobRowDto,
} from '@/lib/api/jobs-client';
import { EDITABLE_AFTER_PUBLISH } from '@/lib/services/jobs';
import { formatIST } from '@/lib/utils/time';
import type { CreateJobInput } from '@/lib/validation/job';

import { JobHeader, type JobPermissions } from './job-header';
import { ReasonDialog } from './reason-dialog';
import { SubtaskPanel } from './subtask-panel';

/** Converts a stored UTC instant back into the naive IST value the form edits. */
function toIstFormValue(iso: string): string {
  return formatIST(new Date(iso), "yyyy-MM-dd'T'HH:mm");
}

/** Every field the server freezes once a job is published. */
const FROZEN_AFTER_PUBLISH = (
  ['partNumber', 'drawingNumber', 'quantity', 'overallDeadline'] as const
).filter((field) => !(EDITABLE_AFTER_PUBLISH as readonly string[]).includes(field));

export function JobDetail({ job, permissions }: { job: JobRowDto; permissions: JobPermissions }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [holdOpen, setHoldOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const isDraft = job.status === 'DRAFT';
  const isOnHold = job.status === 'ON_HOLD';

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      router.refresh();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not reach the server.');
    } finally {
      setBusy(false);
    }
  }

  async function handleEdit(values: CreateJobInput) {
    await updateJobRequest(job.id, values);
    setEditing(false);
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href="/jobs">
          <ArrowLeft className="size-4" />
          All jobs
        </Link>
      </Button>

      {error ? (
        <Alert variant="destructive" role="alert">
          <AlertTitle>That did not work</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <JobHeader
        job={job}
        permissions={permissions}
        busy={busy}
        editing={editing}
        onToggleEdit={() => setEditing((value) => !value)}
        onPublish={() => run(() => publishJobRequest(job.id))}
        onToggleHold={() => (isOnHold ? run(() => unholdJobRequest(job.id)) : setHoldOpen(true))}
        onCancel={() => setCancelOpen(true)}
      />

      {isDraft ? (
        <Alert>
          <AlertTitle>This job is still a draft</AlertTitle>
          <AlertDescription className="space-y-3">
            <p>
              Nobody has been notified. Add at least one department subtask, then publish — that is
              what starts the deadlines and the reminders.
            </p>
            {permissions.edit ? (
              <Button asChild size="sm">
                <Link href={`/jobs/${job.id}/plan`}>
                  <ListTodo className="size-4" />
                  Plan the subtasks
                </Link>
              </Button>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}

      {editing ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Edit job</CardTitle>
            <CardDescription>
              {isDraft
                ? 'Everything can still be changed while the job is a draft.'
                : 'The job is published, so the part number, drawing, quantity and overall deadline are fixed.'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <JobForm
              submitLabel="Save changes"
              onSubmit={handleEdit}
              onCancel={() => setEditing(false)}
              // Mirrors the server rule so the restriction is visible before the
              // MD types, not after they submit.
              frozenFields={isDraft ? [] : FROZEN_AFTER_PUBLISH}
              defaultValues={{
                title: job.title,
                customerName: job.customerName ?? undefined,
                partNumber: job.partNumber ?? undefined,
                drawingNumber: job.drawingNumber ?? undefined,
                quantity: job.quantity ?? undefined,
                priority: job.priority,
                description: job.description ?? undefined,
                overallDeadline: toIstFormValue(job.overallDeadline),
              }}
            />
          </CardContent>
        </Card>
      ) : null}

      <SubtaskPanel
        jobId={job.id}
        canManage={permissions.edit}
        onJobChanged={() => router.refresh()}
      />

      {/* Filled in by M9. */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <History className="size-4" />
            Activity
          </CardTitle>
          <CardDescription>
            Every status change, deadline change and decision, with who and when.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-muted-foreground text-sm">
          Coming in M9. Every action on this job is already being recorded.
        </CardContent>
      </Card>

      <ReasonDialog
        open={holdOpen}
        onOpenChange={setHoldOpen}
        title={`Put ${job.jobCode} on hold?`}
        description="Deadlines stop counting against this job until you resume it. Nobody is chased in the meantime."
        confirmLabel="Put on hold"
        onConfirm={async (reason) => {
          await holdJobRequest(job.id, reason);
          setHoldOpen(false);
          router.refresh();
        }}
      />

      <ReasonDialog
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        title={`Cancel ${job.jobCode}?`}
        description="The job and every open subtask on it are cancelled. Nothing is deleted — the record stays for the history."
        confirmLabel="Cancel job"
        destructive
        onConfirm={async (reason) => {
          await cancelJobRequest(job.id, reason);
          setCancelOpen(false);
          router.refresh();
        }}
      />
    </div>
  );
}
