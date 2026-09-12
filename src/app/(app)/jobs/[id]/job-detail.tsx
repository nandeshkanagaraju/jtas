'use client';

import {
  ArrowLeft,
  Ban,
  ChevronDown,
  ListTodo,
  History,
  Pause,
  Pencil,
  Play,
  Send,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { JobForm } from '@/app/(app)/jobs/components/job-form';
import {
  DeadlineCell,
  JobProgress,
  JobStatusBadge,
  PriorityBadge,
} from '@/app/(app)/jobs/components/job-badges';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Separator } from '@/components/ui/separator';

import { ReasonDialog } from './reason-dialog';
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

interface Permissions {
  edit: boolean;
  publish: boolean;
  hold: boolean;
  cancel: boolean;
}

/** One labelled fact in the header card. */
function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="space-y-0.5">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="text-sm font-medium">{value ?? '—'}</dd>
    </div>
  );
}

/** Converts a stored UTC instant back into the naive IST value the form edits. */
function toIstFormValue(iso: string): string {
  return formatIST(new Date(iso), "yyyy-MM-dd'T'HH:mm");
}

export function JobDetail({ job, permissions }: { job: JobRowDto; permissions: Permissions }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [holdOpen, setHoldOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const isDraft = job.status === 'DRAFT';
  const isOnHold = job.status === 'ON_HOLD';
  const isClosed = job.status === 'CANCELLED' || job.status === 'COMPLETED';

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

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-1">
              <div className="tabular text-muted-foreground text-sm">{job.jobCode}</div>
              <CardTitle className="text-xl">{job.title}</CardTitle>
              <CardDescription className="flex flex-wrap items-center gap-2">
                <JobStatusBadge status={job.status} />
                <PriorityBadge priority={job.priority} />
                {job.publishedAt ? (
                  <span className="text-xs">Published {formatIST(new Date(job.publishedAt))}</span>
                ) : (
                  <span className="text-xs">Not published yet</span>
                )}
              </CardDescription>
            </div>

            {permissions.edit && !isClosed ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" disabled={busy}>
                    Actions
                    <ChevronDown className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-52">
                  <DropdownMenuItem onSelect={() => setEditing((value) => !value)}>
                    <Pencil className="size-4" />
                    {editing ? 'Stop editing' : 'Edit details'}
                  </DropdownMenuItem>

                  {isDraft && permissions.publish ? (
                    <DropdownMenuItem onSelect={() => run(() => publishJobRequest(job.id))}>
                      <Send className="size-4" />
                      Publish job
                    </DropdownMenuItem>
                  ) : null}

                  {!isDraft && permissions.hold ? (
                    <DropdownMenuItem
                      onSelect={() =>
                        isOnHold ? run(() => unholdJobRequest(job.id)) : setHoldOpen(true)
                      }
                    >
                      {isOnHold ? <Play className="size-4" /> : <Pause className="size-4" />}
                      {isOnHold ? 'Resume job' : 'Put on hold'}
                    </DropdownMenuItem>
                  ) : null}

                  {permissions.cancel ? (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem variant="destructive" onSelect={() => setCancelOpen(true)}>
                        <Ban className="size-4" />
                        Cancel job
                      </DropdownMenuItem>
                    </>
                  ) : null}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            <Fact label="Customer" value={job.customerName} />
            <Fact label="Part number" value={job.partNumber} />
            <Fact label="Drawing" value={job.drawingNumber} />
            <Fact label="Quantity" value={job.quantity} />
            <Fact
              label="Overall deadline"
              value={<DeadlineCell deadline={job.overallDeadline} />}
            />
          </dl>

          {job.description ? (
            <>
              <Separator />
              <p className="text-muted-foreground text-sm whitespace-pre-wrap">{job.description}</p>
            </>
          ) : null}

          <Separator />

          <div className="flex flex-wrap items-center gap-6">
            <JobProgress progress={job.progress} />
            <div className="text-muted-foreground text-xs">
              Created by {job.createdBy.name} · {formatIST(new Date(job.createdAt))}
            </div>
          </div>
        </CardContent>
      </Card>

      {isDraft ? (
        <Alert>
          <AlertTitle>This job is still a draft</AlertTitle>
          <AlertDescription>
            Nobody has been notified. Add at least one department subtask, then publish — that is
            what starts the deadlines and the reminders.
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
              // Mirrors the server rule so the restriction is visible before
              // the user types, not after they submit.
              frozenFields={
                isDraft
                  ? []
                  : ['partNumber', 'drawingNumber', 'quantity', 'overallDeadline'].filter(
                      (field) => !(EDITABLE_AFTER_PUBLISH as readonly string[]).includes(field),
                    )
              }
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

      {/* Filled in by M4 (subtask timeline) and M9 (activity feed). */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ListTodo className="size-4" />
              Subtask timeline
            </CardTitle>
            <CardDescription>
              One band per department in shop-flow order, coloured by state.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-muted-foreground text-sm">
            {job.progress.total === 0
              ? 'No subtasks yet. Coming in M4.'
              : `${job.progress.total} subtasks. The timeline lands in M4.`}
          </CardContent>
        </Card>

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
      </div>

      <ReasonDialogs
        job={job}
        holdOpen={holdOpen}
        cancelOpen={cancelOpen}
        setHoldOpen={setHoldOpen}
        setCancelOpen={setCancelOpen}
        onDone={() => router.refresh()}
      />
    </div>
  );
}

/** Kept separate so the detail component stays about layout, not dialogs. */
function ReasonDialogs({
  job,
  holdOpen,
  cancelOpen,
  setHoldOpen,
  setCancelOpen,
  onDone,
}: {
  job: JobRowDto;
  holdOpen: boolean;
  cancelOpen: boolean;
  setHoldOpen: (open: boolean) => void;
  setCancelOpen: (open: boolean) => void;
  onDone: () => void;
}) {
  return (
    <>
      <ReasonDialog
        open={holdOpen}
        onOpenChange={setHoldOpen}
        title={`Put ${job.jobCode} on hold?`}
        description="Deadlines stop counting against this job until you resume it. Nobody is chased in the meantime."
        confirmLabel="Put on hold"
        onConfirm={async (reason) => {
          await holdJobRequest(job.id, reason);
          setHoldOpen(false);
          onDone();
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
          onDone();
        }}
      />
    </>
  );
}
