'use client';

import Link from 'next/link';

import { Ban, ChevronDown, Pause, Pencil, Play, ScrollText, Send } from 'lucide-react';

import { JobProgress } from '@/app/(app)/jobs/components/job-badges';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { JobRowDto } from '@/lib/api/jobs-client';
import { completionLabel, deadlineLabel } from '@/lib/utils/relative-time';
import { formatIST } from '@/lib/utils/time';

const STATUS_WORD: Record<string, { label: string; className: string }> = {
  DRAFT: { label: 'Draft', className: 'text-foreground' },
  IN_PROGRESS: { label: 'In progress', className: 'text-foreground' },
  AT_RISK: { label: 'At risk', className: 'text-risk' },
  DELAYED: { label: 'Delayed', className: 'text-late' },
  ON_HOLD: { label: 'On hold', className: 'text-foreground' },
  COMPLETED: { label: 'Completed', className: 'text-ok' },
  CANCELLED: { label: 'Cancelled', className: 'text-foreground' },
};

const PRIORITY_WORD: Record<string, string> = {
  LOW: 'Low',
  NORMAL: 'Normal',
  HIGH: 'High',
  URGENT: 'Urgent',
};

export interface JobPermissions {
  edit: boolean;
  publish: boolean;
  hold: boolean;
  cancel: boolean;
  /** Whether to offer the audit trace (MD and ADMIN — SDD 6.3). */
  viewAudit: boolean;
}

/**
 * One line of a traveller: a small label, a dotted rule, the value at the right.
 *
 * `machine` is for a code, a number, or a timestamp. A name or a sentence stays
 * in Outfit.
 */
function Fact({
  label,
  value,
  machine = false,
}: {
  label: string;
  value: React.ReactNode;
  machine?: boolean;
}) {
  return (
    <div className="border-border flex items-baseline border-b border-dotted py-2.5">
      <dt className="bg-background text-muted-foreground w-28 shrink-0 pr-3 text-[11px] font-medium tracking-[0.16em] uppercase sm:w-36">
        {label}
      </dt>
      <dd
        className={cn(
          'bg-background text-foreground ml-auto min-w-0 pl-3 text-right text-base',
          machine && 'font-mono',
        )}
      >
        {value ?? '—'}
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
  const status = STATUS_WORD[job.status] ?? { label: job.status, className: 'text-foreground' };
  const whenClass =
    when.tone === 'overdue'
      ? 'text-late'
      : when.tone === 'urgent' || when.tone === 'soon'
        ? 'text-risk'
        : 'text-foreground';

  return (
    <header>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <p className="text-foreground font-mono text-xl font-medium tracking-tight">
            {job.jobCode}
          </p>
          <h1 className="text-foreground text-xl font-semibold">{job.title}</h1>
          {permissions.viewAudit ? (
            <Link
              href={`/audit?job=${job.id}`}
              className="text-foreground decoration-border focus-visible:outline-ring inline-flex min-h-11 items-center gap-1 text-sm underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2"
            >
              <ScrollText className="size-3.5" />
              Full history
            </Link>
          ) : null}
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
      </div>

      <dl className="mt-6">
        <Fact label="Status" value={<span className={status.className}>{status.label}</span>} />
        <Fact label="Priority" value={PRIORITY_WORD[job.priority] ?? job.priority} />
        <Fact label="Customer" value={job.customerName} />
        <Fact label="Part number" value={job.partNumber} machine />
        <Fact label="Drawing" value={job.drawingNumber} machine />
        <Fact label="Quantity" value={job.quantity} machine />
        <Fact
          label="Deadline"
          value={
            <>
              <span className="font-mono">{formatIST(deadline)}</span>
              <span className={cn('ml-2', whenClass)}>{when.text}</span>
            </>
          }
        />
        <Fact
          label="Published"
          machine={job.publishedAt != null}
          value={job.publishedAt ? formatIST(new Date(job.publishedAt)) : 'Not published yet'}
        />
      </dl>

      {job.description ? (
        <p className="text-foreground mt-4 text-base whitespace-pre-wrap">{job.description}</p>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-6">
        <JobProgress progress={job.progress} />
        <p className="text-foreground text-sm">
          Created by {job.createdBy.name}{' '}
          <span className="font-mono">{formatIST(new Date(job.createdAt))}</span>
        </p>
      </div>
    </header>
  );
}
