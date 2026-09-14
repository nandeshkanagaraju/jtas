'use client';

import Link from 'next/link';

import { Ban, ChevronDown, Pause, Pencil, Play, ScrollText, Send } from 'lucide-react';

import {
  DeadlineCell,
  JobProgress,
  JobStatusBadge,
  PriorityBadge,
} from '@/app/(app)/jobs/components/job-badges';
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
import type { JobRowDto } from '@/lib/api/jobs-client';
import { formatIST } from '@/lib/utils/time';

export interface JobPermissions {
  edit: boolean;
  publish: boolean;
  hold: boolean;
  cancel: boolean;
  /** Whether to offer the audit trace (MD and ADMIN — SDD 6.3). */
  viewAudit: boolean;
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

/**
 * The job header card and the MD action menu.
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

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="text-muted-foreground flex items-center gap-2 text-sm">
              <span className="tabular">{job.jobCode}</span>
              {permissions.viewAudit ? (
                /*
                 * The full trace, not just the JOB rows: the work happened on
                 * the subtasks, and "why was this three weeks late" is answered
                 * there. Only offered to whoever may read the log at all.
                 */
                <Link
                  href={`/audit?job=${job.id}`}
                  className="hover:text-foreground inline-flex items-center gap-1 text-xs underline-offset-4 hover:underline"
                >
                  <ScrollText className="size-3.5" />
                  Full history
                </Link>
              ) : null}
            </div>
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
      </CardHeader>

      <CardContent className="space-y-4">
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          <Fact label="Customer" value={job.customerName} />
          <Fact label="Part number" value={job.partNumber} />
          <Fact label="Drawing" value={job.drawingNumber} />
          <Fact label="Quantity" value={job.quantity} />
          <Fact
            label="Overall deadline"
            value={<DeadlineCell deadline={job.overallDeadline} completedAt={job.completedAt} />}
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
  );
}
