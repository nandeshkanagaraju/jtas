'use client';

import { ClipboardList, Loader2, Plus } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { PageHeader } from '@/components/shared/page-header';
import { Panel } from '@/components/shared/panel';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/shared/states';
import { ActiveFilters, Toolbar, type ActiveFilter } from '@/components/shared/toolbar';
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
import { cn } from '@/lib/utils';

import {
  DeadlineCell,
  DepartmentChain,
  JobProgress,
  JobStatusBadge,
  PriorityBadge,
} from './job-badges';
import {
  ALL,
  JobsFilters,
  PRIORITY_OPTIONS,
  STATUS_OPTIONS,
  type JobFilters,
} from './jobs-filters';

const INITIAL: JobFilters = { search: '', status: ALL, priority: ALL, departmentId: ALL };

const PAGE_SIZE = 25;

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

  /** The chips under the toolbar: what is narrowing the list, and how to undo it. */
  const active = useMemo<ActiveFilter[]>(() => {
    const chips: ActiveFilter[] = [];
    if (debouncedSearch) {
      chips.push({
        key: 'search',
        label: `“${debouncedSearch}”`,
        onClear: () => setFilters((current) => ({ ...current, search: '' })),
      });
    }
    if (filters.status !== ALL) {
      chips.push({
        key: 'status',
        label: STATUS_OPTIONS.find((o) => o.value === filters.status)?.label ?? filters.status,
        onClear: () => setFilters((current) => ({ ...current, status: ALL })),
      });
    }
    if (filters.priority !== ALL) {
      chips.push({
        key: 'priority',
        label: `${PRIORITY_OPTIONS.find((o) => o.value === filters.priority)?.label} priority`,
        onClear: () => setFilters((current) => ({ ...current, priority: ALL })),
      });
    }
    if (filters.departmentId !== ALL) {
      chips.push({
        key: 'department',
        label: departments.find((d) => d.id === filters.departmentId)?.name ?? 'Department',
        onClear: () => setFilters((current) => ({ ...current, departmentId: ALL })),
      });
    }
    return chips;
  }, [debouncedSearch, filters.status, filters.priority, filters.departmentId, departments]);

  const filtered = active.length > 0;

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Every job on the floor"
        title="Jobs"
        lead={lead(total, loading, filtered, error !== null)}
        actions={
          canCreate ? (
            <Button asChild>
              <Link href="/jobs/new">
                <Plus className="size-4" />
                New job
              </Link>
            </Button>
          ) : null
        }
      >
        <div className="space-y-3">
          <Toolbar label="Filter jobs">
            <JobsFilters
              filters={filters}
              departments={departments}
              onChange={(next) => setFilters((current) => ({ ...current, ...next }))}
            />
          </Toolbar>
          <ActiveFilters
            filters={active}
            onClearAll={() => setFilters(INITIAL)}
            resultLabel={
              loading
                ? 'Loading…'
                : error
                  ? 'Not loaded'
                  : filtered
                    ? `${rows.length} shown of ${total} matching`
                    : `${total} ${total === 1 ? 'job' : 'jobs'}`
            }
          />
        </div>
      </PageHeader>

      <Panel flush>
        {loading ? (
          <TableSkeleton rows={6} columns={5} />
        ) : error ? (
          <ErrorState message={error} onRetry={() => void load()} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={ClipboardList}
            title={filtered ? 'No jobs match these filters' : 'No jobs yet'}
            description={
              filtered
                ? 'Clear a filter above, or widen the search.'
                : canCreate
                  ? 'Create a job, break it into department subtasks, and the system will chase everybody from there.'
                  : 'Jobs you have a subtask on will appear here.'
            }
            action={
              filtered ? (
                <Button variant="outline" size="sm" onClick={() => setFilters(INITIAL)}>
                  Clear filters
                </Button>
              ) : canCreate ? (
                <Button asChild size="sm">
                  <Link href="/jobs/new">
                    <Plus className="size-4" />
                    New job
                  </Link>
                </Button>
              ) : null
            }
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="border-rule hover:bg-transparent">
                <TableHead className="pl-4">Job</TableHead>
                <TableHead className="hidden lg:table-cell">Route</TableHead>
                <TableHead className="hidden md:table-cell">Progress</TableHead>
                <TableHead className="hidden sm:table-cell">Deadline</TableHead>
                <TableHead className="pr-4 text-right sm:text-left">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((job) => (
                <TableRow
                  key={job.id}
                  className={cn(
                    // A job carrying a missed subtask deadline is marked on its
                    // leading edge as well as in its status — the status word
                    // can read "In progress" while a department is already late.
                    job.hasOverdueSubtask && 'border-l-late border-l-[3px]',
                  )}
                >
                  <TableCell className={cn('py-3', job.hasOverdueSubtask ? 'pl-[13px]' : 'pl-4')}>
                    <Link
                      href={`/jobs/${job.id}`}
                      className="block space-y-0.5 focus-visible:outline-none"
                    >
                      <span className="code text-muted-foreground block text-xs">
                        {job.jobCode}
                      </span>
                      <span className="block max-w-[13rem] truncate font-medium sm:max-w-none">
                        {job.title}
                      </span>
                      <span className="text-muted-foreground flex flex-wrap items-center gap-x-2 text-xs">
                        {job.customerName ? <span>{job.customerName}</span> : null}
                        {job.partNumber ? <span className="code">· {job.partNumber}</span> : null}
                        <PriorityBadge priority={job.priority} />
                        {job.hasOverdueSubtask ? (
                          <span className="text-late font-medium">· a task is overdue</span>
                        ) : null}
                      </span>
                      {/* The deadline column is hidden on a phone, so the
                          deadline folds in here rather than disappearing. */}
                      <DeadlineCell
                        deadline={job.overallDeadline}
                        completedAt={job.completedAt}
                        compact
                        className="pt-0.5 sm:hidden"
                      />
                    </Link>
                  </TableCell>

                  <TableCell className="hidden lg:table-cell">
                    <DepartmentChain departments={job.departments} />
                  </TableCell>

                  <TableCell className="hidden md:table-cell">
                    <JobProgress progress={job.progress} />
                  </TableCell>

                  <TableCell className="hidden sm:table-cell">
                    <DeadlineCell deadline={job.overallDeadline} completedAt={job.completedAt} />
                  </TableCell>

                  <TableCell className="pr-4 text-right sm:text-left">
                    <JobStatusBadge status={job.status} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Panel>

      {nextCursor && !loading ? (
        <div className="flex justify-center">
          <Button variant="outline" onClick={loadMore} disabled={loadingMore}>
            {loadingMore ? (
              <Loader2 className="size-4 animate-spin motion-reduce:animate-none" />
            ) : null}
            Load {Math.min(PAGE_SIZE, total - rows.length)} more
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/** One sentence of state under the title, rather than a count already in view. */
function lead(total: number, loading: boolean, filtered: boolean, failed: boolean): string {
  if (loading) return 'Loading the job list…';
  // Never report an empty shop when what actually happened is a failed request.
  if (failed) return 'The job list could not be loaded.';
  if (filtered) return 'Filtered. Clear a chip below to widen the list again.';
  if (total === 0) return 'Nothing has been raised yet.';
  return 'Newest deadline first. Open a job for its department-by-department timeline.';
}
