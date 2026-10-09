import Link from 'next/link';

import { JobRelay, type RelayStation } from '@/components/shared/job-relay';
import { formatElapsed } from '@/lib/utils/duration';
import { cn } from '@/lib/utils';
import type { AttentionProblem, AttentionSubtask, JobAtRisk } from '@/lib/services/analytics';

/**
 * The decision, then the queue behind it.
 *
 * One thing is named at the top: who, how long, and the action. Everything
 * else that needs the MD is a single list — open problems, then slipped
 * deadlines, then jobs that are heading for trouble without a red row yet.
 */

type Item =
  | { kind: 'problem'; problem: AttentionProblem }
  | { kind: 'late'; subtask: AttentionSubtask }
  | { kind: 'risk'; job: JobAtRisk };

export function Triage({
  problems,
  overdue,
  atRisk,
  relays,
}: {
  problems: AttentionProblem[];
  overdue: AttentionSubtask[];
  atRisk: JobAtRisk[];
  relays: Record<string, RelayStation[]>;
}) {
  const seen = new Set<string>();
  const items: Item[] = [];

  for (const problem of problems) {
    items.push({ kind: 'problem', problem });
    seen.add(problem.jobId);
  }
  for (const subtask of overdue) {
    items.push({ kind: 'late', subtask });
    seen.add(subtask.jobId);
  }
  for (const job of atRisk) {
    if (job.overdueSubtasks > 0 || seen.has(job.id)) continue;
    items.push({ kind: 'risk', job });
  }

  const [first, ...rest] = items;

  return (
    <div className="space-y-5">
      {first ? <Hero item={first} stations={stationsFor(first, relays)} /> : <Clear />}

      <section
        aria-labelledby="problems-heading"
        className="border-border bg-card rounded-lg border"
      >
        <div className="border-border flex items-baseline justify-between gap-4 border-b px-4 py-3">
          <h2 id="problems-heading" className="section-title">
            Still needs you
          </h2>
          <p className="text-muted-foreground text-sm">
            {rest.length === 0 ? 'Nothing else' : `${rest.length} more`}
          </p>
        </div>
        {rest.length === 0 ? (
          <p className="text-muted-foreground px-4 py-5 text-sm">
            {first ? 'Nothing else needs you.' : 'Nothing is waiting on you.'}
          </p>
        ) : (
          <ol>
            {rest.map((item) => (
              <li key={keyOf(item)} className="border-border border-t first:border-t-0">
                <QueueRow item={item} stations={stationsFor(item, relays)} />
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}

function stationsFor(item: Item, relays: Record<string, RelayStation[]>): RelayStation[] {
  const id =
    item.kind === 'risk'
      ? item.job.id
      : item.kind === 'problem'
        ? item.problem.jobId
        : item.subtask.jobId;
  return relays[id] ?? [];
}

function keyOf(item: Item): string {
  if (item.kind === 'problem') return `problem-${item.problem.id}`;
  if (item.kind === 'late') return `late-${item.subtask.id}`;
  return `risk-${item.job.id}`;
}

function Clear() {
  return (
    <div className="border-ok-edge bg-ok-soft text-ok rounded-lg border px-4 py-4 text-sm font-medium">
      Nothing is waiting on you — no open problem and no deadline past due.
    </div>
  );
}

function Hero({ item, stations }: { item: Item; stations: RelayStation[] }) {
  const action = actionFor(item);

  return (
    <section
      aria-label="Decide now"
      className="border-border bg-card overflow-hidden rounded-lg border"
    >
      <div className="flex">
        <span
          aria-hidden
          className={cn('w-1 shrink-0', action.late ? 'bg-late' : 'bg-foreground')}
        />
        <div className="min-w-0 flex-1 px-4 py-4 sm:px-5 sm:py-5">
          <p className="eyebrow">Decide now</p>
          <div className="mt-3 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="min-w-0 flex-1">
              <p className="font-mono text-sm font-medium">{action.code}</p>
              <h2 className="mt-1 text-xl font-medium tracking-[-0.02em] sm:text-2xl">
                {action.title}
              </h2>
              {action.detail ? (
                <p className="mt-2 max-w-2xl text-sm leading-relaxed">{action.detail}</p>
              ) : null}
              <p className="mt-2 text-sm">
                <span className="font-medium">{action.who}</span>
                <span className="text-muted-foreground"> · {action.where}</span>
                <span className={action.late ? 'text-late' : 'text-muted-foreground'}>
                  {' · '}
                  {action.elapsed}
                </span>
              </p>
              <p className="mt-1 text-sm">
                {action.state}
                {action.late ? <span className="text-late"> · Overdue</span> : null}
              </p>
              {stations.length > 0 ? (
                <JobRelay stations={stations} density="card" className="mt-4 max-w-xl" />
              ) : null}
            </div>
            <Link
              href={action.href}
              data-touch-target
              className="bg-primary text-primary-foreground hover:bg-primary/90 inline-flex min-h-11 w-full shrink-0 items-center justify-center rounded-md px-4 text-sm font-medium transition-colors duration-150 sm:w-auto"
            >
              {action.label}
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

function QueueRow({ item, stations }: { item: Item; stations: RelayStation[] }) {
  const action = actionFor(item);

  return (
    <Link
      href={action.href}
      className="hover:bg-muted/60 flex flex-col gap-2 px-4 py-3 transition-colors duration-150"
    >
      {stations.length > 0 ? <JobRelay stations={stations} density="inline" /> : null}
      <span className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span className="font-mono text-sm font-medium">{action.code}</span>
        <span
          className={cn(
            'font-mono text-sm tabular-nums',
            action.late ? 'text-late' : 'text-muted-foreground',
          )}
        >
          {action.elapsed}
        </span>
      </span>
      <span className="block text-sm font-medium">{action.title}</span>
      <span className="text-muted-foreground block text-sm">
        {action.where} · {action.who} · {action.state}
        {action.late ? <span className="text-late"> · Overdue</span> : null}
      </span>
    </Link>
  );
}

function actionFor(item: Item): {
  href: string;
  label: string;
  code: string;
  title: string;
  detail: string | null;
  who: string;
  where: string;
  elapsed: string;
  state: string;
  late: boolean;
} {
  if (item.kind === 'problem') {
    const problem = item.problem;
    return {
      href: `/problems?open=${problem.id}`,
      label: 'Review and decide',
      code: problem.jobCode,
      title: problem.subtaskTitle,
      detail: problem.description,
      who: problem.assigneeName,
      where: problem.departmentName,
      elapsed: `waiting ${formatElapsed(problem.ageHours * 60)}`,
      state: `Problem · ${problem.severity}`,
      late: false,
    };
  }

  if (item.kind === 'late') {
    const subtask = item.subtask;
    return {
      href: `/tasks/${subtask.id}`,
      label: 'Open the task',
      code: subtask.jobCode,
      title: subtask.title,
      detail: null,
      who: subtask.assigneeName,
      where: subtask.departmentName,
      elapsed: `${formatElapsed(subtask.overdueHours * 60)} late`,
      state: statusWord(subtask.status),
      late: true,
    };
  }

  const job = item.job;
  return {
    href: `/jobs/${job.id}`,
    label: 'Open the job',
    code: job.jobCode,
    title: job.title,
    detail: null,
    who: job.blockingSubtaskTitle ?? 'The customer date still holds',
    where: job.blockingDepartment ?? 'Nothing is overdue yet',
    elapsed: 'inside the deadline',
    state: 'At risk',
    late: false,
  };
}

function statusWord(status: string): string {
  switch (status) {
    case 'PENDING':
      return 'Not started';
    case 'BLOCKED':
      return 'Blocked';
    case 'IN_PROGRESS':
      return 'In progress';
    case 'PROBLEM':
      return 'Problem';
    case 'AWAITING_APPROVAL':
      return 'With the MD';
    case 'ON_HOLD':
      return 'On hold';
    case 'COMPLETED':
      return 'Done';
    default:
      return status;
  }
}
