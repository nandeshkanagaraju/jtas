'use client';

import Link from 'next/link';

import { Ban, ChevronDown, Pause, Pencil, Play, ScrollText, Send } from 'lucide-react';

import { JobProgress, JobStatusBadge, PriorityBadge } from '@/app/(app)/jobs/components/job-badges';
import { PageHeader } from '@/components/shared/page-header';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { JobRowDto } from '@/lib/api/jobs-client';
import { cn } from '@/lib/utils';
import { completionLabel, deadlineLabel } from '@/lib/utils/relative-time';
import { formatIST } from '@/lib/utils/time';

export interface JobPermissions {
  edit: boolean;
  publish: boolean;
  hold: boolean;
  cancel: boolean;
  /** Whether to offer the audit trace (MD and ADMIN — SDD 6.3). */
  viewAudit: boolean;
}

/**
 * One fact from the job card: a quiet label with the value under it.
 *
 * This used to be a dotted rule with a shouted label on the left and the value
 * pushed to the far right — a layout that made eight ordinary facts look like a
 * specification, and left the eye travelling the width of the screen to pair a
 * label with its value. Label above value, in a grid, reads in one glance.
 */
function Fact({
  label,
  value,
  machine = false,
}: {
  label: string;
  value: React.ReactNode;
  /** A code, a number or a timestamp, which gets the mono face. */
  machine?: boolean;
}) {
  return (
    <div className="min-w-0">
      <dt className="field-label">{label}</dt>
      <dd className={cn('text-foreground mt-0.5 truncate text-sm', machine && 'code')}>
        {value ?? <span className="text-muted-foreground">—</span>}
      </dd>
    </div>
  );
}

/**
 * The job header and the MD action menu.
 *
 * Which actions appear follows the job's status as well as the caller's
 * permissions — publishing a published job or holding a draft are refused by
 * the server, so offering them would only produce errors.
 */
export function JobHeader({
  job,
  permissions,
  busy,
  editing,
  onToggleEdit,
  onPublish,
  onToggleHold,
  onCancel,
}: {
  job: JobRowDto;
  permissions: JobPermissions;
  busy: boolean;
  editing: boolean;
  onToggleEdit: () => void;
  onPublish: () => void;
  onToggleHold: () => void;
  onCancel: () => void;
}) {
  const isDraft = job.status === 'DRAFT';
  const isOnHold = job.status === 'ON_HOLD';
  const isClosed = job.status === 'CANCELLED' || job.status === 'COMPLETED';

  const deadline = new Date(job.overallDeadline);
  const when = job.completedAt
    ? completionLabel(deadline, new Date(job.completedAt))
    : deadlineLabel(deadline);
  const whenClass =
    when.tone === 'overdue'
      ? 'text-late font-medium'
      : when.tone === 'urgent' || when.tone === 'soon'
        ? 'text-risk font-medium'
        : 'text-muted-foreground';

  return (
    <PageHeader
      back={{ href: '/jobs', label: 'All jobs' }}
      eyebrow={job.jobCode}
      title={job.title}
      lead={
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <JobStatusBadge status={job.status} />
          <PriorityBadge priority={job.priority} />
          {job.customerName ? <span>· {job.customerName}</span> : null}
        </span>
      }
      actions={
        <>
          {permissions.viewAudit ? (
            <Button asChild variant="outline">
              <Link href={`/audit?job=${job.id}`}>
                <ScrollText className="size-4" />
                <span className="hidden sm:inline">Full history</span>
              </Link>
            </Button>
          ) : null}

          {permissions.edit && !isClosed ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" disabled={busy}>
                  Actions
                  <ChevronDown className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuItem onSelect={onToggleEdit}>
                  <Pencil className="size-4" />
                  {editing ? 'Stop editing' : 'Edit details'}
                </DropdownMenuItem>

                {isDraft && permissions.publish ? (
                  <DropdownMenuItem onSelect={onPublish}>
                    <Send className="size-4" />
                    Publish job
                  </DropdownMenuItem>
                ) : null}

                {!isDraft && permissions.hold ? (
                  <DropdownMenuItem onSelect={onToggleHold}>
                    {isOnHold ? <Play className="size-4" /> : <Pause className="size-4" />}
                    {isOnHold ? 'Resume job' : 'Put on hold'}
                  </DropdownMenuItem>
                ) : null}

                {permissions.cancel ? (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem variant="destructive" onSelect={onCancel}>
                      <Ban className="size-4" />
                      Cancel job
                    </DropdownMenuItem>
                  </>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </>
      }
    >
      {/*
        The job card: deadline first and largest, because it is the only fact on
        this screen that anybody is ever chased about. The part details sit
        beside it as a grid rather than a stacked specification.
      */}
      <div className="border-border bg-card grid gap-4 rounded-lg border p-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="sm:col-span-2 lg:col-span-1">
          <p className="field-label">Overall deadline</p>
          <p className="code text-foreground mt-0.5 text-base font-medium">{formatIST(deadline)}</p>
          <p className={cn('mt-0.5 text-sm', whenClass)}>{when.text}</p>
        </div>

        <div className="sm:col-span-2 lg:col-span-1">
          <p className="field-label">Progress</p>
          <div className="mt-1.5">
            <JobProgress progress={job.progress} />
          </div>
        </div>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:col-span-2 lg:grid-cols-2">
          <Fact label="Part number" value={job.partNumber} machine />
          <Fact label="Drawing" value={job.drawingNumber} machine />
          <Fact label="Quantity" value={job.quantity} machine />
          <Fact
            label="Published"
            machine={job.publishedAt != null}
            value={
              job.publishedAt ? (
                formatIST(new Date(job.publishedAt), 'dd MMM yyyy')
              ) : (
                <span className="text-muted-foreground">Not yet</span>
              )
            }
          />
        </dl>
      </div>

      {job.description ? (
        <p className="text-foreground max-w-prose text-sm whitespace-pre-wrap">{job.description}</p>
      ) : null}

      <p className="text-muted-foreground text-xs">
        Raised by {job.createdBy.name} on{' '}
        <span className="code">{formatIST(new Date(job.createdAt), 'dd MMM yyyy, hh:mm a')}</span>
      </p>
    </PageHeader>
  );
}
