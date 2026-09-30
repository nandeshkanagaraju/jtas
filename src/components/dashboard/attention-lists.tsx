import Link from 'next/link';

import { formatElapsed } from '@/lib/utils/duration';
import type { AttentionProblem, AttentionSubtask } from '@/lib/services/analytics';

/**
 * The two lists the MD opens the dashboard to read (build spec M8.3).
 *
 * Problems someone raised, then deadlines that have already slipped. Both are
 * capped. A longer list is a link to the rest, not a second page of rows.
 * A job code that slips more than once is one heading, with each subtask
 * under it. A code that appears once stays a single row.
 *
 * How long something has waited is `formatElapsed`. A 17-day-old problem
 * reads as "2 weeks", not as a count of leftover minutes.
 */

function waiting(hours: number): string {
  return formatElapsed(hours * 60);
}

function severityClass(severity: string): string {
  if (severity === 'BLOCKER')
    return 'rounded-full bg-[#fb7185]/15 px-2 py-0.5 text-xs font-semibold text-[#fb7185]';
  if (severity === 'HIGH')
    return 'rounded-full bg-[#fbbf24]/15 px-2 py-0.5 text-xs font-semibold text-[#fbbf24]';
  return 'text-[#aeb6c3]';
}

function chased(count: number): string {
  if (count === 0) return 'not chased yet';
  return count === 1 ? 'chased 1 time' : `chased ${count} times`;
}

const ROW =
  'mt-3 block rounded-xl border border-[#313743] bg-[#262b36] px-4 py-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d6f25a]';

const PANEL = 'rounded-lg border border-[#313743] bg-[#1e222b] p-4';

const MUTE = 'text-[#aeb6c3]';

const CODE = 'font-mono text-sm font-medium whitespace-nowrap text-[#f3f5f8]';

/** Keep the service order. A job that appears more than once is one heading. */
function groupByJob(subtasks: AttentionSubtask[]) {
  const groups: { jobId: string; jobCode: string; items: AttentionSubtask[] }[] = [];
  for (const subtask of subtasks) {
    const current = groups.find((group) => group.jobId === subtask.jobId);
    if (current) current.items.push(subtask);
    else groups.push({ jobId: subtask.jobId, jobCode: subtask.jobCode, items: [subtask] });
  }
  return groups;
}

export function AttentionLists({
  problems,
  overdueSubtasks,
  openProblems,
  overdueTotal,
}: {
  problems: AttentionProblem[];
  overdueSubtasks: AttentionSubtask[];
  /** Shop-wide totals. The lists themselves stop at eight. */
  openProblems: number;
  overdueTotal: number;
}) {
  // Both lists present: problems a third, slipped deadlines the rest. The
  // short panel is only as tall as its rows. An empty list is one sentence
  // on its own full-width panel. Below 1024px they stack either way.
  const both = problems.length > 0 && overdueSubtasks.length > 0;

  return (
    <div className={both ? 'grid items-start gap-6 lg:grid-cols-3' : 'grid gap-6'}>
      <div className={both ? 'lg:col-span-1' : undefined}>
        <ProblemList problems={problems} total={openProblems} />
      </div>
      <div className={both ? 'lg:col-span-2' : undefined}>
        <DeadlineList subtasks={overdueSubtasks} total={overdueTotal} />
      </div>
    </div>
  );
}

function ProblemList({ problems, total }: { problems: AttentionProblem[]; total: number }) {
  const hidden = Math.max(0, total - problems.length);

  return (
    <section aria-labelledby="attention-problems" className={PANEL}>
      <h2
        id="attention-problems"
        className="flex items-baseline justify-between gap-4 border-b border-[#313743] py-3 text-sm font-semibold text-[#f3f5f8]"
      >
        <span>Problems</span>
        <span
          className={
            total > 0
              ? 'font-mono text-sm font-medium text-[#fb7185]'
              : 'font-mono text-sm font-medium text-[#aeb6c3]'
          }
        >
          {total}
        </span>
      </h2>

      {problems.length === 0 ? (
        <p className="border-b border-[#313743] py-4 text-sm leading-6 text-[#aeb6c3]">
          Nothing is waiting on you.
        </p>
      ) : (
        <ul>
          {problems.map((problem) => (
            <li key={problem.id}>
              <Link href={`/problems?open=${problem.id}`} className={ROW}>
                <div className="flex items-baseline justify-between gap-4">
                  <span className={CODE}>{problem.jobCode}</span>
                  <span className={`shrink-0 ${severityClass(problem.severity)}`}>
                    {problem.severity}
                  </span>
                </div>
                <p className="mt-2 text-sm leading-6 font-semibold text-[#f3f5f8]">
                  {problem.subtaskTitle}
                </p>
                <p className="mt-1 line-clamp-2 text-sm leading-6 text-[#f3f5f8]">
                  {problem.description}
                </p>
                <p className={`mt-1 text-sm leading-6 ${MUTE}`}>
                  {problem.departmentName}, {problem.assigneeName}, waiting{' '}
                  {waiting(problem.ageHours)}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {hidden > 0 ? (
        <p className="border-b border-[#313743] py-4 text-sm leading-6">
          <Link
            href="/problems"
            className="text-[#f3f5f8] underline decoration-[#313743] underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f3f5f8]"
          >
            {hidden === 1 ? '1 more in the inbox' : `${hidden} more in the inbox`}
          </Link>
        </p>
      ) : null}
    </section>
  );
}

function DeadlineList({ subtasks, total }: { subtasks: AttentionSubtask[]; total: number }) {
  const hidden = Math.max(0, total - subtasks.length);

  return (
    <section aria-labelledby="attention-overdue" className={PANEL}>
      <h2
        id="attention-overdue"
        className="flex items-baseline justify-between gap-4 border-b border-[#313743] py-3 text-sm font-semibold text-[#f3f5f8]"
      >
        <span>Deadlines that slipped</span>
        <span
          className={
            total > 0
              ? 'font-mono text-sm font-medium text-[#fb7185]'
              : 'font-mono text-sm font-medium text-[#aeb6c3]'
          }
        >
          {total}
        </span>
      </h2>

      {subtasks.length === 0 ? (
        <p className="border-b border-[#313743] py-4 text-sm leading-6 text-[#aeb6c3]">
          No deadline has slipped.
        </p>
      ) : (
        <ul>
          {groupByJob(subtasks).map((group) =>
            group.items.length === 1 ? (
              <li key={group.items[0].id}>
                <SlippedRow subtask={group.items[0]} showCode />
              </li>
            ) : (
              <li key={group.jobId}>
                <Link
                  href={`/jobs/${group.jobId}`}
                  className="block pt-4 font-mono text-sm font-medium text-[#f3f5f8] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f3f5f8]"
                >
                  {group.jobCode}
                  <span className="ml-2 font-sans text-sm font-normal text-[#aeb6c3]">
                    {group.items.length} slipped
                  </span>
                </Link>
                <ul>
                  {group.items.map((subtask) => (
                    <li key={subtask.id}>
                      <SlippedRow subtask={subtask} />
                    </li>
                  ))}
                </ul>
              </li>
            ),
          )}
        </ul>
      )}

      {hidden > 0 ? (
        <p className="border-b border-[#313743] py-4 text-sm leading-6">
          <Link
            href="/jobs?filter=overdue"
            className="text-[#f3f5f8] underline decoration-[#313743] underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f3f5f8]"
          >
            {hidden === 1 ? '1 more past its deadline' : `${hidden} more past their deadline`}
          </Link>
        </p>
      ) : null}
    </section>
  );
}

function SlippedRow({ subtask, showCode }: { subtask: AttentionSubtask; showCode?: boolean }) {
  return (
    <Link href={`/tasks/${subtask.id}`} className={ROW}>
      <div className="sm:flex sm:items-baseline sm:justify-between sm:gap-4">
        {showCode ? (
          <span className={CODE}>{subtask.jobCode}</span>
        ) : (
          <p className="text-sm leading-6 text-[#f3f5f8]">
            <span className="font-semibold">{subtask.departmentName}</span>
            {' — '}
            {subtask.title}
          </p>
        )}
        <p className="mt-1 shrink-0 text-sm leading-6 font-semibold text-[#fb7185] sm:mt-0">
          {waiting(subtask.overdueHours)} late
        </p>
      </div>
      {showCode ? (
        <>
          <p className="mt-2 text-sm leading-6 font-semibold text-[#f3f5f8]">{subtask.title}</p>
          <p className={`mt-1 text-sm leading-6 ${MUTE}`}>
            {subtask.departmentName}, {subtask.assigneeName}, {chased(subtask.escalationCount)}
          </p>
        </>
      ) : (
        <p className={`mt-1 text-sm leading-6 ${MUTE}`}>
          {subtask.assigneeName}, {chased(subtask.escalationCount)}
        </p>
      )}
    </Link>
  );
}
