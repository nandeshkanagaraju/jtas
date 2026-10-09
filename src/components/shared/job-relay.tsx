import { cn } from '@/lib/utils';

/**
 * The baton.
 *
 * One job is a relay through the shop. Each station is a department's piece
 * of it. Filled means done, hollow means still ahead, the mark is who holds
 * it now, and late is a condition painted on top of the state — never a
 * replacement for it.
 *
 * Three densities, one component:
 *   inline  a row in a list, readable with no labels
 *   card    the dashboard, labels and the holder named
 *   full    the job, each station openable
 */

const SHORT: Record<string, string> = {
  PLANNING: 'PLN',
  PURCHASE: 'PUR',
  STORE: 'STR',
  PRODUCTION: 'PRD',
  QUALITY: 'QLY',
  DISPATCH: 'DSP',
  ACCOUNTS: 'ACC',
  HR: 'HR',
};

const STATUS_WORD: Record<string, string> = {
  PENDING: 'Not started',
  BLOCKED: 'Blocked',
  IN_PROGRESS: 'In progress',
  PROBLEM: 'Problem',
  AWAITING_APPROVAL: 'With the MD',
  COMPLETED: 'Done',
  ON_HOLD: 'On hold',
  CANCELLED: 'Cancelled',
};

export interface RelayInput {
  id: string;
  status: string;
  /** Active lateness. Completed work must not set this from the clock. */
  isOverdue: boolean;
  deadline: Date | string | null;
  completedAt: Date | string | null;
  createdAt: Date | string;
  title: string;
  department: { code: string; name: string; sequenceOrder: number };
  assignee: { name: string };
  openProblem?: { description: string } | null;
}

export interface RelayStation {
  id: string;
  code: string;
  name: string;
  title: string;
  holder: string;
  status: string;
  statusLabel: string;
  /** Finished after its deadline, or still open and past it. */
  late: boolean;
  done: boolean;
  current: boolean;
  problem: string | null;
}

function millis(value: Date | string | null): number {
  if (!value) return 0;
  return new Date(value).getTime();
}

function finishedLate(row: RelayInput): boolean {
  if (row.status !== 'COMPLETED' || !row.completedAt || !row.deadline) return false;
  return millis(row.completedAt) > millis(row.deadline);
}

/** Shop-flow order, one station per subtask, baton on whoever is actually working. */
export function relayStations(rows: RelayInput[]): RelayStation[] {
  const ordered = [...rows].sort(
    (a, b) =>
      a.department.sequenceOrder - b.department.sequenceOrder ||
      millis(a.createdAt) - millis(b.createdAt),
  );

  const open = ordered.filter((row) => row.status !== 'COMPLETED' && row.status !== 'CANCELLED');
  const working = open.filter((row) => row.status !== 'BLOCKED');
  const holders = working.length > 0 ? working : open.slice(0, 1);
  const current = new Set(holders.map((row) => row.id));

  return ordered.map((row) => {
    const done = row.status === 'COMPLETED';
    const late = done ? finishedLate(row) : row.status !== 'CANCELLED' && row.isOverdue;
    return {
      id: row.id,
      code: SHORT[row.department.code] ?? row.department.code.slice(0, 3),
      name: row.department.name,
      title: row.title,
      holder: row.assignee.name,
      status: row.status,
      statusLabel: STATUS_WORD[row.status] ?? row.status,
      late,
      done,
      current: current.has(row.id),
      problem: row.openProblem?.description ?? null,
    };
  });
}

function describe(station: RelayStation): string {
  const place = station.current ? 'holding the baton' : station.done ? 'done' : 'ahead';
  const late = station.late ? ', late' : '';
  return `${station.name}, ${station.statusLabel}, ${place}${late}`;
}

export function JobRelay({
  stations,
  density = 'inline',
  className,
}: {
  stations: RelayStation[];
  density?: 'inline' | 'card' | 'full';
  className?: string;
}) {
  if (stations.length === 0) return null;

  const summary = stations.map(describe).join('. ');
  const holders = stations.filter((station) => station.current);

  if (density === 'full') {
    return (
      <ol className={cn('space-y-2', className)} aria-label={summary}>
        {stations.map((station) => (
          <li key={station.id}>
            <details className="border-border bg-card group open:bg-card rounded-md border">
              <summary className="flex cursor-pointer list-none items-center gap-3 px-3 py-2.5 [&::-webkit-details-marker]:hidden">
                <Segment station={station} labelled />
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-3">
                    <span className="text-sm font-medium">{station.name}</span>
                    <span className="font-mono text-xs">{station.code}</span>
                  </span>
                  <span className="text-muted-foreground mt-0.5 block text-sm">
                    {station.holder}
                    {' · '}
                    {station.statusLabel}
                    {station.late ? <span className="text-late"> · Late</span> : null}
                  </span>
                </span>
              </summary>
              <div className="border-border space-y-1 border-t px-3 py-2.5 text-sm">
                <p>{station.title}</p>
                {station.problem ? <p className="text-foreground">{station.problem}</p> : null}
              </div>
            </details>
          </li>
        ))}
      </ol>
    );
  }

  return (
    <div className={className}>
      <ol className="flex w-full gap-1" aria-label={summary}>
        {stations.map((station) => (
          <li key={station.id} className="min-w-0 flex-1">
            <Segment station={station} labelled={density === 'card'} />
            {density === 'card' ? (
              <span className="text-muted-foreground mt-1 block truncate text-center font-mono text-xs">
                {station.code}
              </span>
            ) : null}
          </li>
        ))}
      </ol>
      {density === 'card' && holders.length > 0 ? (
        <p className="mt-2 text-sm">
          <span className="text-muted-foreground">Holding </span>
          <span className="font-medium">
            {holders.map((station) => `${station.holder} (${station.name})`).join(' · ')}
          </span>
          {holders.some((station) => station.late) ? (
            <span className="text-late"> · Late</span>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}

function Segment({ station, labelled }: { station: RelayStation; labelled: boolean }) {
  return (
    <span
      className={cn(
        'relative block h-2 rounded-[2px] border',
        station.done && !station.late && 'bg-ok border-ok',
        station.done && station.late && 'bg-late border-late',
        !station.done && station.late && 'bg-late-soft border-late',
        !station.done && !station.late && station.current && 'bg-info border-info',
        !station.done && !station.late && !station.current && 'border-border bg-transparent',
      )}
      title={labelled ? undefined : describe(station)}
    >
      {station.current ? (
        <span
          aria-hidden
          className="bg-foreground ring-card absolute top-1/2 left-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2"
        />
      ) : null}
    </span>
  );
}
