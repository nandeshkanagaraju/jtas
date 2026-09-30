import Link from 'next/link';

import { formatElapsed } from '@/lib/utils/duration';
import type { AttentionProblem, AttentionSubtask } from '@/lib/services/analytics';

/**
 * The two lists the MD opens the dashboard to read (build spec M8.3).
 *
 * Problems someone raised, then deadlines that have already slipped. Both are
 * capped. A longer list is a link to the rest, not a second page of rows.
 *
 * How long something has waited is `formatElapsed`. A 17-day-old problem
 * reads as "2 weeks", not as a count of leftover minutes.
 */

function waiting(hours: number): string {
  return formatElapsed(hours * 60);
}

function severityClass(severity: string): string {
  if (severity === 'BLOCKER') return 'text-[#9f1239]';
  if (severity === 'HIGH') return 'text-[#92400e]';
  return 'text-[#1c2430]';
}

function chased(count: number): string {
  if (count === 0) return 'not chased yet';
  return count === 1 ? 'chased 1 time' : `chased ${count} times`;
}

const ROW =
  'block border-b border-[#d5dbe3] py-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1c2430]';

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
  const sideBySide = problems.length > 0 && overdueSubtasks.length > 0;

  return (
    <div className={sideBySide ? 'grid items-start gap-10 lg:grid-cols-2' : 'space-y-8'}>
      <ProblemList problems={problems} total={openProblems} />
      <DeadlineList subtasks={overdueSubtasks} total={overdueTotal} />
    </div>
  );
}

function ProblemList({ problems, total }: { problems: AttentionProblem[]; total: number }) {
  const hidden = Math.max(0, total - problems.length);

  return (
    <section aria-labelledby="attention-problems">
      <h2
        id="attention-problems"
        className="flex items-baseline justify-between gap-4 border-b border-[#d5dbe3] pb-2 text-base font-semibold text-[#1c2430]"
      >
        <span>Problems</span>
        <span className="tabular">{problems.length}</span>
      </h2>

      {problems.length === 0 ? (
        <p className="border-b border-[#d5dbe3] py-3 text-base text-[#1c2430]">
          Nothing is waiting on you.
        </p>
      ) : (
        <ul>
          {problems.map((problem) => (
            <li key={problem.id}>
              <Link href={`/problems?open=${problem.id}`} className={ROW}>
                <div className="flex items-baseline justify-between gap-4">
                  <span className="tabular text-xl font-semibold text-[#1c2430]">
                    {problem.jobCode}
                  </span>
                  <span className={`text-base font-semibold ${severityClass(problem.severity)}`}>
                    {problem.severity}
                  </span>
                </div>
                <p className="mt-1 text-base text-[#1c2430]">
                  {problem.departmentName}, waiting {waiting(problem.ageHours)}
                </p>
                <p className="mt-1 line-clamp-2 text-base text-[#1c2430]">{problem.description}</p>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {hidden > 0 ? (
        <p className="border-b border-[#d5dbe3] py-3 text-base">
          <Link
            href="/problems"
            className="text-[#1c2430] underline decoration-[#d5dbe3] underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1c2430]"
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
    <section aria-labelledby="attention-overdue">
      <h2
        id="attention-overdue"
        className="flex items-baseline justify-between gap-4 border-b border-[#d5dbe3] pb-2 text-base font-semibold text-[#1c2430]"
      >
        <span>Deadlines that slipped</span>
        <span className={subtasks.length > 0 ? 'tabular text-[#9f1239]' : 'tabular'}>
          {subtasks.length}
        </span>
      </h2>

      {subtasks.length === 0 ? (
        <p className="border-b border-[#d5dbe3] py-3 text-base text-[#1c2430]">
          No deadline has slipped.
        </p>
      ) : (
        <ul>
          {subtasks.map((subtask) => (
            <li key={subtask.id}>
              <Link href={`/jobs/${subtask.jobId}`} className={ROW}>
                <div className="sm:flex sm:items-baseline sm:justify-between sm:gap-4">
                  <span className="tabular text-xl font-semibold text-[#1c2430]">
                    {subtask.jobCode}
                  </span>
                  <p className="mt-1 text-base font-semibold text-[#9f1239] sm:mt-0">
                    {waiting(subtask.overdueHours)} late
                  </p>
                </div>
                <p className="mt-1 text-base font-semibold text-[#1c2430]">{subtask.title}</p>
                <p className="mt-1 text-base text-[#1c2430]">
                  {subtask.departmentName}, {chased(subtask.escalationCount)}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {hidden > 0 ? (
        <p className="border-b border-[#d5dbe3] py-3 text-base">
          <Link
            href="/jobs?filter=overdue"
            className="text-[#1c2430] underline decoration-[#d5dbe3] underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1c2430]"
          >
            {hidden === 1 ? '1 more past its deadline' : `${hidden} more past their deadline`}
          </Link>
        </p>
      ) : null}
    </section>
  );
}
