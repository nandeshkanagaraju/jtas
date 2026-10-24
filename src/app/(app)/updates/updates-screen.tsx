'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  ArrowRight,
  Bell,
  CheckCircle2,
  MessageSquare,
  Radio,
  RefreshCw,
  Search,
} from 'lucide-react';
import { useLanguage } from '@/lib/i18n/provider';
import { PageHeader } from '@/components/shared/page-header';
import { PhoneDisclosure } from '@/components/shared/phone-app';
import { Panel } from '@/components/shared/panel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ErrorState, ListSkeleton } from '@/components/shared/states';
import { useLiveResource } from '@/lib/client/use-live-resource';
import { apiFetch } from '@/lib/api/client';
import { formatIST } from '@/lib/utils/time';
import { cn } from '@/lib/utils';
import type { LiveJobList, LiveJobDetail, UpdateKind } from '@/lib/live-updates/types';
import { toast } from '@/lib/i18n/toast';
import { ProgressMap, STATUS_LABELS } from './progress-map';
import { DepartmentProgressStrip } from './department-progress-strip';
import { UpdateTimeline } from './update-timeline';
import { MessageComposer } from './message-composer';

const FILTERS: [UpdateKind, string][] = [
  ['all', 'All updates'],
  ['messages', 'Messages'],
  ['workflow', 'Workflow'],
  ['issues', 'Problems'],
  ['files', 'Files'],
];
export function UpdatesScreen({
  initialList,
  initialDetail,
  initialState,
  departmentId,
}: {
  initialList: LiveJobList;
  initialDetail: LiveJobDetail | null;
  initialState: 'active' | 'all';
  departmentId: string | null;
}) {
  const { t } = useLanguage();
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [state, setState] = useState<string>(initialState);
  const [page, setPage] = useState(1);
  const [jobId, setJobId] = useState(initialDetail?.job.id ?? '');
  const currentJob = useRef(jobId);
  currentJob.current = jobId;
  const [kind, setKind] = useState<UpdateKind>('all');
  const [taskId, setTaskId] = useState('');
  const [mode, setMode] = useState<'map' | 'updates'>('map');
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [history, setHistory] = useState<LiveJobDetail[]>([]);
  const [olderBusy, setOlderBusy] = useState(false);
  const listUrl =
    '/api/live-jobs?' + new URLSearchParams({ q, state, page: String(page), pageSize: '20' });
  const jobs = useLiveResource<LiveJobList>(listUrl, initialList);
  const detailUrl = jobId
    ? `/api/live-jobs/${encodeURIComponent(jobId)}?` +
      new URLSearchParams({ kind, ...(taskId ? { taskId } : {}) })
    : null;
  const snapshot = useLiveResource<LiveJobDetail>(detailUrl, initialDetail, jobId);
  const currentDetailUrl = useRef(detailUrl);
  currentDetailUrl.current = detailUrl;
  const data = snapshot.data;
  const timeline = history.at(-1) ?? (snapshot.current ? data : null);
  useEffect(() => {
    const timeout = setTimeout(() => {
      setQ(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timeout);
  }, [search]);
  useEffect(() => {
    if (!jobId && jobs.data?.data[0]) setJobId(jobs.data.data[0].id);
  }, [jobId, jobs.data]);
  function selectJob(id: string) {
    setJobId(id);
    setTaskId('');
    setKind('all');
    setHistory([]);
    setMode('map');
    const url = new URL(location.href);
    url.searchParams.set('job', id);
    historyApi(url);
  }
  function historyApi(url: URL) {
    window.history.replaceState(null, '', url);
  }
  function selectTask(id: string) {
    setTaskId(id);
    setHistory([]);
    if (id) setMode('updates');
  }
  async function loadOlder() {
    if (!timeline?.nextCursor || !detailUrl || olderBusy) return;
    const url = detailUrl;
    const cursor = timeline.nextCursor;
    setOlderBusy(true);
    try {
      const older = await apiFetch<LiveJobDetail>(url + '&cursor=' + encodeURIComponent(cursor));
      if (currentJob.current === older.job.id && currentDetailUrl.current === url)
        setHistory((previous) => [...previous, older]);
    } catch {
      toast.error('Could not load older updates. Try again.');
    } finally {
      setOlderBusy(false);
    }
  }
  const preferred =
    taskId ||
    data?.stages.find((stage) => stage.department.id === departmentId && stage.canComment)?.id ||
    data?.stages.find((stage) => stage.current && stage.canComment)?.id ||
    '';
  const rows = jobs.data?.data ?? [];
  const selectedInList = rows.some((row) => row.id === jobId);
  const chosenStage = data?.stages.find((stage) => stage.id === taskId);
  const connectionError = jobs.error || snapshot.error;
  return (
    <div className="live-centre w-full space-y-5">
      <PageHeader
        eyebrow={t('Across departments')}
        title={t('Live updates')}
        lead={t('Follow each job, see who has it now, and keep the conversation together.')}
        actions={
          <Button asChild variant="outline">
            <Link href="/notifications">
              <Bell className="size-4" aria-hidden />
              {t('My notifications')}
            </Link>
          </Button>
        }
      />
      <div className="live-centre-toolbar">
        <PhoneDisclosure title="Find a job">
          <div className="live-search-controls">
            <label className="live-search">
              <Search className="size-4 shrink-0" aria-hidden />
              <Input
                aria-label={t('Search jobs')}
                placeholder={t('Search job code, part or title…')}
                maxLength={200}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
            <select
              aria-label={t('Jobs to show')}
              className="live-select"
              value={state}
              onChange={(event) => {
                setState(event.target.value);
                setPage(1);
              }}
            >
              <option value="active">{t('Active jobs')}</option>
              <option value="completed">{t('Completed jobs')}</option>
              <option value="all">{t('All jobs')}</option>
            </select>
          </div>
        </PhoneDisclosure>
        <div className="live-connection" role="status">
          <span className={cn('live-connection-dot', connectionError && 'live-connection-stale')} />
          <span>
            {t(
              connectionError
                ? 'Updates paused — retrying'
                : snapshot.fetching && !data
                  ? 'Connecting…'
                  : 'Auto-updates every 5 seconds',
            )}
          </span>
        </div>
        <Button
          size="icon"
          variant="ghost"
          aria-label={t('Refresh updates')}
          onClick={() => {
            jobs.refresh();
            snapshot.refresh();
          }}
        >
          <RefreshCw
            className={cn(
              'size-4',
              (jobs.fetching || snapshot.fetching) && 'motion-safe:animate-spin',
            )}
            aria-hidden
          />
        </Button>
      </div>
      <div className="live-centre-layout">
        <aside className="live-job-sidebar" aria-label={t('Jobs')}>
          <div className="text-muted-foreground mb-3 flex items-center justify-between gap-3 text-xs">
            <span>{t('{{count}} jobs', { count: jobs.data?.total ?? 0 })}</span>
            <span>{t('Page {{page}}', { page })}</span>
          </div>
          <label className="live-job-picker">
            <span className="mb-2 block text-sm font-medium">{t('Choose a job')}</span>
            <select
              className="live-select w-full"
              aria-label={t('Choose a job')}
              value={jobId}
              onChange={(event) => selectJob(event.target.value)}
            >
              <option value="">{t('Choose a job')}</option>
              {!selectedInList && data ? (
                <option value={data.job.id}>
                  {data.job.jobCode} · {data.job.title}
                </option>
              ) : null}
              {rows.map((job) => (
                <option key={job.id} value={job.id}>
                  {job.jobCode} · {job.title}
                </option>
              ))}
            </select>
          </label>
          <div className="live-job-list">
            {!jobs.data && !jobs.error ? (
              <ListSkeleton rows={3} />
            ) : (
              rows.map((job) => (
                <button
                  key={job.id}
                  type="button"
                  aria-pressed={job.id === jobId}
                  onClick={() => selectJob(job.id)}
                  className="live-job-choice"
                >
                  <span className="code text-xs">{job.jobCode}</span>
                  <span className="mt-1 block font-medium">{job.title}</span>
                  <span className="text-muted-foreground mt-2 block text-xs">
                    {t(STATUS_LABELS[job.status] ?? job.status)} · {job.progress.percent}%
                  </span>
                  <span className="live-progress-track mt-2">
                    <span style={{ width: `${job.progress.percent}%` }} />
                  </span>
                  {job.currentDepartments.length ? (
                    <span className="text-muted-foreground mt-2 block text-xs">
                      {job.currentDepartments.join(' · ')}
                    </span>
                  ) : null}
                  {job.openProblems ? (
                    <span className="text-late mt-2 block text-xs">
                      {t('{{count}} open problems', { count: job.openProblems })}
                    </span>
                  ) : null}
                </button>
              ))
            )}
          </div>
          {jobs.data && !rows.length ? (
            <p className="text-muted-foreground py-4 text-sm">
              {t('No jobs match these filters.')}{' '}
              {state !== 'all' ? (
                <button
                  type="button"
                  className="text-action underline"
                  onClick={() => {
                    setState('all');
                    setPage(1);
                  }}
                >
                  {t('Show all jobs')}
                </button>
              ) : null}
            </p>
          ) : null}
          {jobs.error ? (
            <p className="text-late mt-3 text-xs">{t('Could not refresh the job list.')}</p>
          ) : null}
          {jobs.data && jobs.data.total > jobs.data.pageSize ? (
            <div className="mt-3 flex items-center justify-between gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page === 1}
                onClick={() => setPage((value) => value - 1)}
                aria-label={t('Previous page')}
              >
                <ArrowLeft className="size-4" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page * jobs.data.pageSize >= jobs.data.total}
                onClick={() => setPage((value) => value + 1)}
                aria-label={t('Next page')}
              >
                <ArrowRight className="size-4" />
              </Button>
            </div>
          ) : null}
        </aside>
        <div className="min-w-0 space-y-5">
          {!jobId ? (
            <Panel>
              <div className="py-12 text-center">
                <Radio className="text-action mx-auto mb-4 size-8" aria-hidden />
                <h2 className="text-lg font-semibold">{t('Choose a job to see its story')}</h2>
                <p className="text-muted-foreground mx-auto mt-2 max-w-md text-sm">
                  {t('Department progress, messages, deadlines and handoffs will appear here.')}
                </p>
              </div>
            </Panel>
          ) : !data ? (
            snapshot.error ? (
              <ErrorState
                title="Could not load this job"
                message="Refresh or choose another job you can access."
                onRetry={snapshot.refresh}
              />
            ) : (
              <ListSkeleton rows={4} />
            )
          ) : (
            <>
              <section className="live-job-heading">
                <div className="min-w-0">
                  <p className="code text-action text-xs">{data.job.jobCode}</p>
                  <h2 className="mt-2 text-xl font-semibold break-words">{data.job.title}</h2>
                  <p className="text-muted-foreground mt-2 text-sm">
                    {t(STATUS_LABELS[data.job.status] ?? data.job.status)}
                    {data.job.partNumber ? ` · ${data.job.partNumber}` : ''}
                  </p>
                  <p className="mt-3 text-sm">
                    <span className="text-muted-foreground">{t('Now at')}: </span>
                    {data.job.currentDepartments.length
                      ? data.job.currentDepartments.join(' · ')
                      : t(
                          data.job.status === 'COMPLETED'
                            ? 'All departments finished'
                            : data.job.status === 'ON_HOLD'
                              ? 'Job on hold'
                              : 'No active department',
                        )}
                  </p>
                </div>
                <div className="live-job-progress">
                  <strong className="font-mono text-3xl">{data.job.progress.percent}%</strong>
                  <p className="text-muted-foreground mt-1 text-xs">
                    {t('{{done}} of {{total}} tasks complete', {
                      done: data.job.progress.completed,
                      total: data.job.progress.total,
                    })}
                  </p>
                  <span className="live-progress-track mt-3">
                    <span style={{ width: `${data.job.progress.percent}%` }} />
                  </span>
                  <Link
                    className="text-action mt-3 inline-flex min-h-11 items-center text-sm underline"
                    href={`/jobs/${data.job.id}`}
                  >
                    {t('Open job details')}
                    <ArrowRight className="ml-2 size-3" aria-hidden />
                  </Link>
                </div>
              </section>
              <DepartmentProgressStrip stages={data.stages} jobStatus={data.job.status} />
              <div className="live-phone-views" role="group" aria-label={t('Centre view')}>
                <Button
                  variant={mode === 'map' ? 'secondary' : 'ghost'}
                  aria-pressed={mode === 'map'}
                  onClick={() => setMode('map')}
                >
                  <CheckCircle2 className="size-4" aria-hidden />
                  {t('Progress map')}
                </Button>
                <Button
                  variant={mode === 'updates' ? 'secondary' : 'ghost'}
                  aria-pressed={mode === 'updates'}
                  onClick={() => setMode('updates')}
                >
                  <MessageSquare className="size-4" aria-hidden />
                  {t('Updates and messages')}
                </Button>
              </div>
              <div
                className={cn(
                  'live-content-grid',
                  mode === 'map' ? 'live-view-map' : 'live-view-updates',
                )}
              >
                <Panel
                  title={t('Department progress map')}
                  description={t(
                    'Follow the arrows. Tap a stage to see its updates. Times are IST.',
                  )}
                  className="live-map-panel"
                  bodyClassName="p-3 sm:p-4"
                >
                  {data.stages.length ? (
                    <ProgressMap stages={data.stages} selected={taskId} onSelect={selectTask} />
                  ) : (
                    <p className="text-muted-foreground text-sm">
                      {t('Departments have not been assigned yet.')}
                    </p>
                  )}
                  {taskId ? (
                    <Button className="mt-3 w-full" variant="ghost" onClick={() => selectTask('')}>
                      {t('Show all departments')}
                    </Button>
                  ) : null}
                </Panel>
                <Panel
                  id="live-job-updates"
                  title={t('Updates and messages')}
                  description={
                    chosenStage
                      ? `${chosenStage.department.name} · ${chosenStage.title}`
                      : t('One shared timeline for everyone on this job.')
                  }
                  className="live-feed-panel"
                  flush
                >
                  <div className="live-feed-controls">
                    <select
                      className="live-select w-full"
                      aria-label={t('Department updates')}
                      value={taskId}
                      onChange={(event) => selectTask(event.target.value)}
                    >
                      <option value="">{t('All departments')}</option>
                      {data.stages.map((stage) => (
                        <option key={stage.id} value={stage.id}>
                          {stage.department.name} · {stage.title}
                        </option>
                      ))}
                    </select>
                    <div className="live-kind-filters" role="group" aria-label={t('Update type')}>
                      {FILTERS.map(([value, label]) => (
                        <button
                          type="button"
                          key={value}
                          aria-pressed={kind === value}
                          onClick={() => {
                            setKind(value);
                            setHistory([]);
                          }}
                        >
                          {t(label)}
                        </button>
                      ))}
                    </div>
                  </div>
                  {history.length ? (
                    <div className="live-history-note">
                      <span>{t('Viewing older updates')}</span>
                      <button
                        type="button"
                        className="text-action min-h-11 underline"
                        onClick={() => setHistory([])}
                      >
                        {t('Back to live')}
                      </button>
                    </div>
                  ) : null}
                  <div
                    className="live-feed-body"
                    aria-busy={(!snapshot.current || !timeline) && snapshot.fetching}
                  >
                    {timeline ? (
                      <UpdateTimeline items={timeline.events} />
                    ) : (
                      <ListSkeleton rows={3} />
                    )}
                  </div>
                  {snapshot.error ? (
                    <p className="text-late px-5 pb-3 text-sm" role="status">
                      {t('Connection interrupted. Showing the last received updates.')}
                    </p>
                  ) : null}
                  <div className="flex flex-wrap items-center justify-between gap-2 border-t px-4 py-2">
                    <span className="text-muted-foreground text-xs">
                      {t('Received at')} {formatIST(new Date(data.checkedAt), 'HH:mm:ss')} IST
                    </span>
                    {timeline?.nextCursor ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={olderBusy}
                        onClick={() => void loadOlder()}
                      >
                        {t(olderBusy ? 'Loading…' : 'Older updates')}
                      </Button>
                    ) : null}
                  </div>
                  <MessageComposer
                    key={jobId}
                    stages={data.stages}
                    preferred={preferred}
                    draft={drafts}
                    onDraft={(id, value) => setDrafts((previous) => ({ ...previous, [id]: value }))}
                    onPosted={(id) => {
                      toast.success('Message posted.');
                      if (currentJob.current === data.job.id) {
                        setTaskId(id);
                        setKind('messages');
                        setHistory([]);
                        snapshot.refresh();
                      }
                    }}
                  />
                  {chosenStage ? (
                    <Link
                      className="text-action mx-4 mb-4 inline-flex min-h-11 items-center gap-2 text-sm underline"
                      href={`/tasks/${chosenStage.id}`}
                    >
                      {t('Open department work')}
                      <ArrowRight className="size-3" aria-hidden />
                    </Link>
                  ) : null}
                </Panel>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
