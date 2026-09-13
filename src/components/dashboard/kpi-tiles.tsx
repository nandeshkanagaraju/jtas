import Link from 'next/link';
import {
  AlertTriangle,
  Briefcase,
  CalendarClock,
  CheckCircle2,
  Clock,
  TriangleAlert,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import type { KpiCounts } from '@/lib/services/analytics';

/**
 * The six tiles (build spec M8.3).
 *
 * Each is a link, not a card with a number on it: a count the MD cannot open is
 * a number they have to go and look for somewhere else, which is how dashboards
 * become decoration.
 */
interface Tile {
  label: string;
  value: number;
  href: string;
  icon: typeof Briefcase;
  /** Shown under the number when there is something worth saying. */
  note?: string;
  tone: 'neutral' | 'warn' | 'bad' | 'good';
}

const TONE: Record<Tile['tone'], string> = {
  neutral: 'text-foreground',
  good: 'text-state-complete',
  warn: 'text-state-problem',
  bad: 'text-state-overdue',
};

export function KpiTiles({ kpis }: { kpis: KpiCounts }) {
  const tiles: Tile[] = [
    {
      label: 'Active jobs',
      value: kpis.activeJobs,
      href: '/jobs?status=active',
      icon: Briefcase,
      tone: 'neutral',
    },
    {
      label: 'At risk',
      value: kpis.atRiskJobs,
      href: '/jobs?status=AT_RISK',
      icon: TriangleAlert,
      tone: kpis.atRiskJobs > 0 ? 'warn' : 'neutral',
    },
    {
      label: 'Delayed',
      value: kpis.delayedJobs,
      href: '/jobs?status=DELAYED',
      icon: CalendarClock,
      tone: kpis.delayedJobs > 0 ? 'bad' : 'neutral',
    },
    {
      label: 'Overdue subtasks',
      value: kpis.overdueSubtasks,
      href: '/jobs?filter=overdue',
      icon: Clock,
      tone: kpis.overdueSubtasks > 0 ? 'bad' : 'neutral',
    },
    {
      label: 'Open problems',
      value: kpis.openProblems,
      href: '/problems',
      icon: AlertTriangle,
      // The age is the part that matters: two problems raised this morning is a
      // normal day, two raised on Tuesday is a decision nobody made.
      note:
        kpis.openProblemsOlderThan24h > 0
          ? `${kpis.openProblemsOlderThan24h} waiting over 24 h`
          : undefined,
      tone: kpis.openProblemsOlderThan24h > 0 ? 'bad' : kpis.openProblems > 0 ? 'warn' : 'neutral',
    },
    {
      label: 'Completed',
      value: kpis.completedThisMonth,
      href: '/jobs?status=COMPLETED',
      icon: CheckCircle2,
      note: 'in this range',
      tone: 'good',
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {tiles.map((tile) => (
        <Link
          key={tile.label}
          href={tile.href}
          className="hover:bg-accent/40 focus-visible:ring-ring group rounded-lg border p-4 transition-colors focus-visible:ring-2 focus-visible:outline-none"
        >
          <div className="text-muted-foreground flex items-center gap-1.5 text-xs font-medium">
            <tile.icon className="size-3.5" />
            <span className="truncate">{tile.label}</span>
          </div>

          <p className={cn('tabular mt-2 text-3xl font-semibold', TONE[tile.tone])}>{tile.value}</p>

          {tile.note ? (
            <p className="text-muted-foreground mt-1 text-xs leading-tight">{tile.note}</p>
          ) : null}
        </Link>
      ))}
    </div>
  );
}
