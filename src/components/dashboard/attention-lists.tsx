import Link from 'next/link';

import { Empty, Section } from '@/components/dashboard/section';
import { Badge } from '@/components/ui/badge';
import { formatElapsed } from '@/lib/utils/duration';
import { severityTone } from '@/lib/ui/tone';
import { cn } from '@/lib/utils';
import type { AttentionProblem, AttentionSubtask } from '@/lib/services/analytics';

/**
 * The two queues the MD opens the dashboard to read (build spec M8.3).
 *
 * Deadlines that slipped are a table at desktop width — job, task, owner,
 * lateness, chasing — because the question is comparative: which of these is
 * worst, and who is holding the most of them. Below `md` the same rows become
 * stacked blocks, since five columns on a phone are five columns of nothing.
 *
 * Both lists are capped by the service. The remainder is a footer link to the
 * full screen, not a second page of rows: the dashboard's job is to point at
 * the work, not to contain it.
 *
 * How long something has waited is `formatElapsed`, so a 17-day-old problem
 * reads as "2 weeks" rather than as a count of leftover minutes.
 */

function waited(hours: number): string {
  return formatElapsed(hours * 60);
}

function chased(count: number): string {
  if (count === 0) return 'not chased';
  return count === 1 ? 'chased 1×' : `chased ${count}×`;
}

const CODE = 'font-mono text-[13px] font-medium whitespace-nowrap';

/* -------------------------------------------------------------- problems -- */

export function ProblemList({ problems, total }: { problems: AttentionProblem[]; total: number }) {
  const hidden = Math.max(0, total - problems.length);

  return (
    <Section
      id="attention-problems"
      title="Problems"
      count={total}
      countTone="late"
      footer={
        hidden > 0
          ? {
              href: '/problems',
              label: hidden === 1 ? '1 more in the inbox' : `${hidden} more in the inbox`,
            }
          : undefined
      }
    >
      {problems.length === 0 ? (
        <Empty>No one is blocked. Nothing is waiting on a decision.</Empty>
      ) : (
        <ul>
          {problems.map((problem) => (
            <li key={problem.id} className="border-border border-t first:border-t-0">
              <Link
                href={`/problems?open=${problem.id}`}
                className="hover:bg-muted/60 block px-4 py-3 transition-colors"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className={CODE}>{problem.jobCode}</span>
                  <Badge variant={severityTone(problem.severity)} className="shrink-0">
                    {problem.severity}
                  </Badge>
                </div>
                <p className="mt-1.5 truncate text-sm font-medium">{problem.subtaskTitle}</p>
                <p className="text-foreground/80 mt-0.5 line-clamp-2 text-sm">
                  {problem.description}
                </p>
                <p className="text-muted-foreground mt-1.5 text-xs">
                  {problem.departmentName} · {problem.assigneeName} ·{' '}
                  <span className="text-late font-medium">waiting {waited(problem.ageHours)}</span>
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

/* ------------------------------------------------------------- deadlines -- */

export function SlippedDeadlines({
  subtasks,
  total,
}: {
  subtasks: AttentionSubtask[];
  total: number;
}) {
  const hidden = Math.max(0, total - subtasks.length);

  return (
    <Section
      id="attention-overdue"
      title="Deadlines that slipped"
      count={total}
      countTone="late"
      footer={
        hidden > 0
          ? {
              href: '/jobs?filter=overdue',
              label:
                hidden === 1 ? '1 more past its deadline' : `${hidden} more past their deadline`,
            }
          : undefined
      }
    >
      {subtasks.length === 0 ? (
        <Empty>No deadline has slipped.</Empty>
      ) : (
        <>
          {/* Desktop: five columns, sorted worst-first by the service. */}
          <table className="hidden w-full table-fixed border-collapse md:table">
            <thead>
              <tr className="border-border border-b">
                <Th className="w-[7rem]">Job</Th>
                <Th>Task</Th>
                <Th className="w-[6.5rem]">Team</Th>
                <Th className="w-[9.5rem]">Owner</Th>
                <Th className="w-[6rem] text-right">Late by</Th>
                <Th className="w-[5rem] text-right">Chasing</Th>
              </tr>
            </thead>
            <tbody>
              {subtasks.map((subtask) => (
                <tr
                  key={subtask.id}
                  className="border-border hover:bg-muted/60 border-b transition-colors last:border-b-0"
                >
                  <Td>
                    <Link href={`/jobs/${subtask.jobId}`} className={cn(CODE, 'hover:underline')}>
                      {subtask.jobCode}
                    </Link>
                  </Td>
                  <Td>
                    <Link
                      href={`/tasks/${subtask.id}`}
                      className="block truncate font-medium hover:underline"
                    >
                      {subtask.title}
                    </Link>
                  </Td>
                  <Td className="truncate">{subtask.departmentName}</Td>
                  <Td className="text-muted-foreground truncate">{subtask.assigneeName}</Td>
                  <Td className="text-late text-right font-medium tabular-nums">
                    {waited(subtask.overdueHours)}
                  </Td>
                  <Td className="text-muted-foreground text-right tabular-nums">
                    {subtask.escalationCount === 0 ? '—' : `${subtask.escalationCount}×`}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Phone: the same rows, stacked. */}
          <ul className="md:hidden">
            {subtasks.map((subtask) => (
              <li key={subtask.id} className="border-border border-t first:border-t-0">
                <Link
                  href={`/tasks/${subtask.id}`}
                  className="hover:bg-muted/60 block px-4 py-3 transition-colors"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className={CODE}>{subtask.jobCode}</span>
                    <span className="text-late shrink-0 text-sm font-medium tabular-nums">
                      {waited(subtask.overdueHours)} late
                    </span>
                  </div>
                  <p className="mt-1.5 text-sm font-medium">{subtask.title}</p>
                  <p className="text-muted-foreground mt-0.5 text-xs">
                    {subtask.departmentName} · {subtask.assigneeName} ·{' '}
                    {chased(subtask.escalationCount)}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </Section>
  );
}

function Th({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <th scope="col" className={cn('eyebrow px-4 py-2 text-left font-normal', className)}>
      {children}
    </th>
  );
}

function Td({ className, children }: { className?: string; children: React.ReactNode }) {
  return <td className={cn('px-4 py-2.5 text-sm whitespace-nowrap', className)}>{children}</td>;
}
