'use client';

import { ArrowUpRight, ClipboardList, LayoutGrid, List, Loader2, Plus } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { JobRelay, relayStations, type RelayStation } from '@/components/shared/job-relay';
import { PageHeader } from '@/components/shared/page-header';
import { Panel } from '@/components/shared/panel';
import { PhoneDisclosure } from '@/components/shared/phone-app';
import { EmptyState, ErrorState } from '@/components/shared/states';
import { ActiveFilters, Toolbar, type ActiveFilter } from '@/components/shared/toolbar';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError } from '@/lib/api/client';
import { fetchJobs, type JobRowDto } from '@/lib/api/jobs-client';
import { fetchJobSubtasks } from '@/lib/api/subtasks-client';
import type { DepartmentSummary } from '@/lib/services/department-service';
import { cn } from '@/lib/utils';

import { DeadlineCell, DepartmentChain, JobStatusBadge, PriorityBadge } from './job-badges';
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
  const [view, setView] = useState<'list' | 'grid'>('grid');
  const [rows, setRows] = useState<JobRowDto[]>([]);
  const [total, setTotal] = useState(0);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [filters, setFilters] = useState<JobFilters>(INITIAL);
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [relays, setRelays] = useState<Record<string, RelayStation[] | null>>({});

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

  // Station state is not on the job list. The existing subtask read fills the
  // sparkline for the rows on screen; a failed read falls back to the route
  // codes rather than inventing which department is done.
  useEffect(() => {
    const missing = rows.filter((row) => relays[row.id] === undefined);
    if (missing.length === 0) return;
    let cancel = false;
    void Promise.all(
      missing.map(async (row) => {
        try {
          const { data } = await fetchJobSubtasks(row.id);
          return [row.id, relayStations(data)] as const;
        } catch {
          return [row.id, null] as const;
        }
      }),
    ).then((entries) => {
      if (cancel) return;
      setRelays((current) => {
        const next = { ...current };
        for (const [id, stations] of entries) next[id] = stations;
        return next;
      });
    });
    return () => {
      cancel = true;
    };
  }, [rows, relays]);

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
        eyebrow="Production / Job register"
        title="Production"
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
        <PhoneDisclosure
          title="Search and filters"
          hint={filtered ? `${active.length} filters applied` : 'Find a job or narrow the register'}
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
        </PhoneDisclosure>
      </PageHeader>

      <div className="flex items-center justify-between gap-3">
        <h2 className="section-title">All jobs</h2>
        <div
          role="group"
          aria-label="Job layout"
          className="border-border bg-card inline-flex gap-1 rounded-lg border p-1"
        >
          {(['list', 'grid'] as const).map((mode) => (
            <Button
              key={mode}
              variant={view === mode ? 'secondary' : 'ghost'}
              size="icon-sm"
              aria-label={`${mode === 'list' ? 'List' : 'Card'} view`}
              aria-pressed={view === mode}
              onClick={() => setView(mode)}
            >
              {mode === 'list' ? <List className="size-4" /> : <LayoutGrid className="size-4" />}
            </Button>
          ))}
        </div>
      </div>
      <Panel
        flush
        className={
          view === 'grid' && !loading && !error && rows.length > 0
            ? 'border-0 bg-transparent shadow-none'
            : undefined
        }
      >
        {loading ? (
          <JobsSkeleton />
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
          <ol className={view === 'grid' ? 'grid gap-4 lg:grid-cols-2 2xl:grid-cols-3' : undefined}>
            {rows.map((job) => (
              <li
                key={job.id}
                className={
                  view === 'grid'
                    ? 'border-border bg-card rounded-2xl border'
                    : 'border-border border-t first:border-t-0'
                }
              >
                <JobRow job={job} stations={relays[job.id]} card={view === 'grid'} />
              </li>
            ))}
          </ol>
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
  return 'Nearest deadline first. Track the route, owner and delivery date of each order.';
}

function JobRow({
  job,
  stations,
  card,
}: {
  card: boolean;
  job: JobRowDto;
  /** Undefined while the route is loading, null when that read failed. */
  stations: RelayStation[] | null | undefined;
}) {
  return (
    <Link
      href={`/jobs/${job.id}`}
      className={cn(
        'group hover:bg-muted/60 focus-visible:outline-ring flex h-full flex-col gap-4 rounded-lg px-5 py-5 transition-colors duration-150',
        !card && 'xl:flex-row xl:items-center xl:gap-6',
        card && 'job-register-card',
        job.hasOverdueSubtask && 'border-l-late border-l-[3px]',
      )}
    >
      <div className="min-w-0 xl:flex-1">
        <span className="code text-muted-foreground block text-xs">{job.jobCode}</span>
        <span className="mt-1 block text-base font-medium">{job.title}</span>
        <span className="text-muted-foreground mt-0.5 flex flex-wrap items-center gap-x-2 text-xs">
          {job.customerName ? <span>{job.customerName}</span> : null}
          {job.partNumber ? <span className="code">{job.partNumber}</span> : null}
          <PriorityBadge priority={job.priority} />
          {job.progress.total > 0 ? (
            <span className="code">
              {job.progress.completed}/{job.progress.total}
            </span>
          ) : null}
        </span>
      </div>

      <div className={cn('block shrink-0', card ? 'w-full' : 'w-full xl:w-64')}>
        {stations === undefined ? (
          <Skeleton className="h-2 w-40" />
        ) : stations && stations.length > 0 ? (
          <JobRelay stations={stations} density="card" />
        ) : (
          <DepartmentChain departments={job.departments} />
        )}
      </div>

      <div className={cn('flex items-center justify-between gap-3', !card && 'xl:contents')}>
        <DeadlineCell deadline={job.overallDeadline} completedAt={job.completedAt} />
        <span className="flex shrink-0 flex-col items-end gap-1 xl:w-28 xl:items-start">
          <JobStatusBadge status={job.status} />
          {job.hasOverdueSubtask ? (
            <span className="text-late text-xs font-medium">Overdue</span>
          ) : null}
        </span>
      </div>
      <ArrowUpRight
        className="text-muted-foreground group-hover:text-action hidden size-4 shrink-0 xl:block"
        aria-hidden
      />
    </Link>
  );
}

function JobsSkeleton() {
  return (
    <div aria-hidden className="divide-border divide-y">
      {Array.from({ length: 6 }, (_, row) => (
        <div key={row} className="flex flex-col gap-3 px-4 py-3 md:flex-row md:items-center">
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-4 w-56 max-w-full" />
          </div>
          <Skeleton className="h-2 w-40" />
          <Skeleton className="h-4 w-28" />
        </div>
      ))}
    </div>
  );
}
