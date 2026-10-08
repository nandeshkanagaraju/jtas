'use client';

import { ListTodo } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { JobForm } from '@/app/(app)/jobs/components/job-form';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Panel } from '@/components/shared/panel';
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
import { AttachmentPanel } from '@/components/collaboration/attachment-panel';

import { ActivityPanel } from './activity-panel';
import { SubtaskPanel } from './subtask-panel';

/** Converts a stored UTC instant back into the naive IST value the form edits. */
function toIstFormValue(iso: string): string {
  return formatIST(new Date(iso), "yyyy-MM-dd'T'HH:mm");
}

/** Every field the server freezes once a job is published. */
const FROZEN_AFTER_PUBLISH = (
  ['partNumber', 'drawingNumber', 'quantity', 'overallDeadline'] as const
).filter((field) => !(EDITABLE_AFTER_PUBLISH as readonly string[]).includes(field));

export function JobDetail({
  job,
  permissions,
  currentUserId,
}: {
  job: JobRowDto;
  permissions: JobPermissions;
  currentUserId: string;
}) {
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
        <Panel
          title="Edit job"
          description={
            isDraft
              ? 'Everything can still be changed while the job is a draft.'
              : 'The job is published, so the part number, drawing, quantity and overall deadline are fixed.'
          }
        >
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
        </Panel>
      ) : null}

      <SubtaskPanel
        jobId={job.id}
        canManage={permissions.edit}
        currentUserId={currentUserId}
        onJobChanged={() => router.refresh()}
      />

      {/* The customer drawing and the PO belong to the job, not to any one
          department's step (build spec M10.4). */}
      <Panel
        title="Job files"
        description="The drawing, the purchase order, anything the whole job needs."
      >
        <AttachmentPanel
          jobId={job.id}
          jobLevelOnly
          headless
          canUpload={permissions.edit}
          canDelete={permissions.edit}
        />
      </Panel>

      {/* Everyone on the job sees the story; only MD and ADMIN get the link
          to the forensic view (SDD 6.3). */}
      <ActivityPanel
        jobId={job.id}
        currentUserId={currentUserId}
        canViewAudit={permissions.viewAudit}
      />

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
