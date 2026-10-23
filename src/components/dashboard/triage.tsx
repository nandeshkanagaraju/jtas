import { LocalizedElement } from '@/lib/i18n/provider';

import { T } from '@/lib/i18n/provider';
import Link from 'next/link';
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  CircleAlert,
  Clock3,
  Flag,
  ListFilter,
} from 'lucide-react';

import { JobRelay, type RelayStation } from '@/components/shared/job-relay';
import { PhoneDisclosure, PhoneQueue } from '@/components/shared/phone-app';
import { formatElapsed } from '@/lib/utils/duration';
import { cn } from '@/lib/utils';
import type { AttentionProblem, AttentionSubtask, JobAtRisk } from '@/lib/services/analytics';

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
    <div className="phone-triage space-y-8">
      {first ? <Hero item={first} stations={stationsFor(first, relays)} /> : <Clear />}
      <section
        aria-labelledby="action-register-heading"
        className="phone-action-register product-panel border-border bg-card border"
        data-empty={rest.length === 0}
      >
        <div className="flex flex-wrap items-center justify-between gap-4 border-b px-5 py-5 sm:px-6">
          <div className="flex items-center gap-3">
            <span className="bg-muted flex size-9 items-center justify-center rounded-lg">
              <ListFilter className="text-muted-foreground size-4" />
            </span>
            <div>
              <h2 id="action-register-heading" className="section-title">
                <T>{'Action register '}</T>
              </h2>
              <p className="text-muted-foreground mt-0.5 text-xs">
                <T>{'Open reports, missed deadlines and delivery risks '}</T>
              </p>
            </div>
          </div>
          <span className="rounded-full border px-3 py-1 font-mono text-xs">
            {rest.length} <T>{' queued '}</T>
          </span>
        </div>
        {rest.length === 0 ? (
          <div className="flex items-center gap-3 px-6 py-10">
            <Check className="text-ok size-5" />
            <p className="text-muted-foreground">
              <T>{'No additional items in the queue.'}</T>
            </p>
          </div>
        ) : (
          <PhoneQueue>
            {rest.map((item, index) => (
              <li key={keyOf(item)}>
                <QueueRow item={item} index={index} />
              </li>
            ))}
          </PhoneQueue>
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
  return item.kind === 'problem'
    ? `problem-${item.problem.id}`
    : item.kind === 'late'
      ? `late-${item.subtask.id}`
      : `risk-${item.job.id}`;
}
function Clear() {
  return (
    <section className="decision-hero flex flex-col items-start gap-5 p-7 sm:flex-row sm:items-center sm:p-9">
      <span className="flex size-14 shrink-0 items-center justify-center rounded-full border border-[#6b7f60] text-[#c3e1b7]">
        <Check className="size-6" />
      </span>
      <div>
        <p className="font-mono text-xs text-[#bec5b6]">
          <T>{'Priority review'}</T>
        </p>
        <h2 className="mt-2 text-2xl tracking-tight">
          <T>{'A clear runway.'}</T>
        </h2>
        <p className="mt-2 text-sm text-[#bec5b6]">
          <T>{'No unresolved reports or missed deadlines require a decision. '}</T>
        </p>
      </div>
      <Link
        href="/jobs"
        className="mt-2 inline-flex items-center gap-2 text-sm font-medium sm:ml-auto"
      >
        <T>{'Explore production '}</T>
        <ArrowRight className="size-4" />
      </Link>
    </section>
  );
}
function Hero({ item, stations }: { item: Item; stations: RelayStation[] }) {
  const action = actionFor(item);
  const complete = stations.filter((station) => station.done).length;
  return (
    <LocalizedElement
      as="section"
      className="decision-hero phone-priority overflow-hidden"
      aria-label="Priority review"
    >
      <div className="grid lg:grid-cols-[1.5fr_1fr]">
        <div className="flex min-w-0 flex-col p-6 sm:p-8 lg:p-9">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="inline-flex items-center gap-2 font-mono text-[11px] tracking-wide text-[#d6cbb6]">
              <span className="size-1.5 rounded-full bg-[#efb48b]" /> <T>{' Priority review '}</T>
            </p>
            <span className="rounded-md border border-[#58634f] px-2 py-1 font-mono text-[10px] text-[#d2d8c9]">
              {action.code}
            </span>
          </div>
          <h2 className="mt-5 max-w-xl text-[clamp(1.5rem,2.5vw,2.25rem)] leading-[1.15] font-medium tracking-[-0.04em]">
            {action.title}
          </h2>
          {action.detail ? (
            <p className="mt-4 max-w-xl text-sm leading-relaxed text-[#d2d8c9]">{action.detail}</p>
          ) : null}
          <div className="mt-7 flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-[#6a735e] px-2.5 py-1 text-xs">
              <CircleAlert className="size-3" />
              {action.state}
            </span>
            <span className="inline-flex items-center gap-1.5 px-1 text-xs text-[#d2d8c9]">
              <Clock3 className="size-3" />
              {action.elapsed}
            </span>
          </div>
        </div>
        <div className="phone-priority-handoff flex min-w-0 flex-col border-t border-[#45513f] p-6 sm:p-8 lg:border-t-0 lg:border-l lg:p-9">
          <PhoneDisclosure
            title="Department handoff"
            hint={`${complete}/${stations.length} complete`}
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-[#c4cebd]">
                <T>{'Department handoff'}</T>
              </p>
              {stations.length > 0 ? (
                <span className="font-mono text-[11px] text-[#c4cebd]">
                  {complete}/{stations.length} <T>{' complete '}</T>
                </span>
              ) : null}
            </div>
            {stations.length > 0 ? (
              <JobRelay stations={stations} density="card" className="mt-4" />
            ) : (
              <p className="mt-4 text-base">{action.where}</p>
            )}
          </PhoneDisclosure>
          <div className="mt-auto pt-5">
            <Link
              href={action.href}
              className="inline-flex min-h-11 w-full items-center justify-between gap-4 rounded-lg bg-[#efc4a7] px-4 py-3 text-sm font-semibold text-[#292b23] transition-colors hover:bg-[#f9dcc7]"
            >
              <T>{action.label}</T>
              <ArrowUpRight className="size-4" />
            </Link>
          </div>
        </div>
      </div>
      <dl className="phone-priority-facts grid grid-cols-1 gap-4 border-t border-[#45513f] px-6 py-5 text-xs sm:grid-cols-3 sm:px-8 lg:px-9">
        <div>
          <dt className="text-[#bec5b6]">
            <T>{'Accountable owner'}</T>
          </dt>
          <dd className="mt-1 text-sm">{action.who}</dd>
        </div>
        <div>
          <dt className="text-[#bec5b6]">
            <T>{'Department'}</T>
          </dt>
          <dd className="mt-1 text-sm">{action.where}</dd>
        </div>
        <div>
          <dt className="text-[#bec5b6]">
            <T>{'Next step'}</T>
          </dt>
          <dd className="mt-1 text-sm">
            {item.kind === 'problem' ? (
              <T>{'Review the report and record a decision'}</T>
            ) : item.kind === 'late' ? (
              <T>{'Review the task and recovery plan'}</T>
            ) : (
              <T>{'Check the remaining department handoffs'}</T>
            )}
          </dd>
        </div>
      </dl>
    </LocalizedElement>
  );
}
function QueueRow({ item, index }: { item: Item; index: number }) {
  const action = actionFor(item);
  const Icon = item.kind === 'problem' ? CircleAlert : item.kind === 'late' ? Clock3 : Flag;
  return (
    <Link href={action.href} className="queue-line group">
      <span
        className={cn(
          'flex size-9 shrink-0 items-center justify-center rounded-full',
          item.kind === 'problem'
            ? 'bg-risk-soft text-risk'
            : item.kind === 'late'
              ? 'bg-late-soft text-late'
              : 'bg-muted text-muted-foreground',
        )}
      >
        <Icon className="size-4" />
        <span className="sr-only">
          <T>{'Item '}</T>
          {index + 1}
        </span>
      </span>
      <div className="min-w-0">
        <div className="mb-1 flex flex-wrap items-center gap-2">
          <span className="text-muted-foreground font-mono text-[11px]">{action.code}</span>
          <span className="text-muted-foreground text-[11px]">/ {action.state}</span>
        </div>
        <p className="text-sm font-medium">{action.title}</p>
      </div>
      <div className="queue-owner min-w-0">
        <p className="text-sm">{action.who}</p>
        <p className="text-muted-foreground mt-0.5 text-xs">{action.where}</p>
      </div>
      <div
        className={cn('queue-timing text-xs', action.late ? 'text-late' : 'text-muted-foreground')}
      >
        {action.elapsed}
        {action.late ? (
          <p className="mt-1 text-[11px]">
            <T>{'Overdue'}</T>
          </p>
        ) : null}
      </div>
      <ArrowUpRight
        className="queue-arrow text-muted-foreground size-4 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
        aria-hidden
      />
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
      label: 'Review report',
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
      label: 'View task',
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
    label: 'View job',
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
