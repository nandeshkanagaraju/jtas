'use client';

import { ClipboardList, Loader2, Plus } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ApiError } from '@/lib/api/client';
import { fetchJobs, type JobRowDto } from '@/lib/api/jobs-client';
import type { DepartmentSummary } from '@/lib/services/department-service';

import { DeadlineCell, JobProgress, JobStatusBadge, PriorityBadge } from './job-badges';
import { ALL, JobsFilters, type JobFilters } from './jobs-filters';

const INITIAL: JobFilters = { search: '', status: ALL, priority: ALL, departmentId: ALL };

const PAGE_SIZE = 25;

/** Nothing to show — and why, which differs by whether filters are active. */
function EmptyState({ filtered, canCreate }: { filtered: boolean; canCreate: boolean }) {
  return (
    <div className="flex flex-col items-center gap-3 py-16 text-center">
      <ClipboardList className="text-muted-foreground size-8" />
      <div className="space-y-1">
        <p className="font-medium">{filtered ? 'No jobs match these filters' : 'No jobs yet'}</p>
        <p className="text-muted-foreground mx-auto max-w-sm text-sm">
          {filtered
            ? 'Try clearing the search or widening the filters.'
            : canCreate
              ? 'Create a job, break it into department subtasks, and the system will chase everybody from there.'
              : 'Jobs you have a subtask on will appear here.'}
        </p>
      </div>
      {!filtered && canCreate ? (
        <Button asChild size="sm">
          <Link href="/jobs/new">
            <Plus className="size-4" />
            New job
          </Link>
        </Button>
      ) : null}
    </div>
  );
}

export function JobsScreen({
  departments,
  canCreate,
}: {
  departments: DepartmentSummary[];
  canCreate: boolean;
}) {
  const [rows, setRows] = useState<JobRowDto[]>([]);
  const [total, setTotal] = useState(0);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [filters, setFilters] = useState<JobFilters>(INITIAL);
  const [debouncedSearch, setDebouncedSearch] = useState('');

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(filters.search), 300);
    return () => window.clearTimeout(timer);
  }, [filters.search]);

  const queryFor = useCallback(
    (cursor?: string) => ({
      q: debouncedSearch || undefined,
      status: filters.status === ALL ? undefined : filters.status,
      priority: filters.priority === ALL ? undefined : filters.priority,
      departmentId: filters.departmentId === ALL ? undefined : filters.departmentId,
      pageSize: PAGE_SIZE,
      cursor,
    }),
    [debouncedSearch, filters.status, filters.priority, filters.departmentId],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchJobs(queryFor());
      setRows(result.data);
      setTotal(result.total);
      setNextCursor(result.nextCursor);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not load jobs.');
    } finally {
      setLoading(false);
    }
  }, [queryFor]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Appends the next cursor page rather than replacing the list. */
  async function loadMore() {
    if (!nextCursor) return;
    setLoadingMore(true);
    try {
      const result = await fetchJobs(queryFor(nextCursor));
      setRows((current) => [...current, ...result.data]);
      setNextCursor(result.nextCursor);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not load more jobs.');
    } finally {
      setLoadingMore(false);
    }
  }

  const filtered =
    debouncedSearch !== '' ||
    filters.status !== ALL ||
    filters.priority !== ALL ||
    filters.departmentId !== ALL;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Jobs</h1>
          <p className="text-muted-foreground text-sm">
            {total} {total === 1 ? 'job' : 'jobs'}
          </p>
        </div>

        {canCreate ? (
          <Button asChild>
            <Link href="/jobs/new">
              <Plus className="size-4" />
              New job
            </Link>
          </Button>
        ) : null}
      </div>

      <JobsFilters
        filters={filters}
        departments={departments}
        onChange={(next) => setFilters((current) => ({ ...current, ...next }))}
      />

      {error ? (
        <p className="text-destructive text-sm" role="alert">
          {error}
        </p>
      ) : null}

      <div className="rounded-lg border">
        {loading ? (
          <div className="text-muted-foreground py-16 text-center">
            <Loader2 className="mx-auto size-5 animate-spin" />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState filtered={filtered} canCreate={canCreate} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Job</TableHead>
                <TableHead className="hidden lg:table-cell">Departments</TableHead>
                <TableHead className="hidden md:table-cell">Progress</TableHead>
                <TableHead className="hidden sm:table-cell">Deadline</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((job) => (
                <TableRow key={job.id} className="cursor-pointer">
                  <TableCell>
                    <Link href={`/jobs/${job.id}`} className="block space-y-0.5">
                      <div className="tabular text-muted-foreground text-xs">{job.jobCode}</div>
                      <div className="max-w-[13rem] truncate font-medium sm:max-w-none">
                        {job.title}
                      </div>
                      <div className="text-muted-foreground flex flex-wrap items-center gap-x-2 text-xs">
                        {job.customerName ? <span>{job.customerName}</span> : null}
                        {job.partNumber ? <span>· {job.partNumber}</span> : null}
                        <PriorityBadge priority={job.priority} />
                      </div>
                      {/* The deadline column is hidden on a phone, so the
                          deadline folds in here rather than disappearing. */}
                      <DeadlineCell
                        deadline={job.overallDeadline}
                        completedAt={job.completedAt}
                        compact
                        className="sm:hidden"
                      />
                    </Link>
                  </TableCell>

                  <TableCell className="text-muted-foreground hidden text-xs lg:table-cell">
                    {job.departments.length === 0
                      ? '—'
                      : job.departments.map((d) => d.name).join(' · ')}
                  </TableCell>

                  <TableCell className="hidden md:table-cell">
                    <JobProgress progress={job.progress} />
                  </TableCell>

                  <TableCell className="hidden sm:table-cell">
                    <DeadlineCell deadline={job.overallDeadline} completedAt={job.completedAt} />
                  </TableCell>

                  <TableCell>
                    <JobStatusBadge status={job.status} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      {nextCursor ? (
        <div className="flex justify-center">
          <Button variant="outline" onClick={loadMore} disabled={loadingMore}>
            {loadingMore ? <Loader2 className="size-4 animate-spin" /> : null}
            Load more
          </Button>
        </div>
      ) : null}
    </div>
  );
}
