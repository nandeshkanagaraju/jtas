import { T } from '@/lib/i18n/provider';
import Link from 'next/link';
import {
  BriefcaseBusiness,
  CalendarClock,
  CircleCheck,
  Clock3,
  Flag,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { textClass, type Tone } from '@/lib/ui/tone';
import type { KpiCounts } from '@/lib/services/analytics';

interface Cell {
  href: string;
  label: string;
  value: number;
  icon: LucideIcon;
  /** Omitted where a non-zero count is simply information, not a warning. */
  tone?: Tone;
  note?: string;
  scope?: string;
}

export function SummaryStrip({ kpis }: { kpis: KpiCounts }) {
  const cells: Cell[] = [
    {
      href: '/jobs?status=active',
      label: 'Active jobs',
      value: kpis.activeJobs,
      icon: BriefcaseBusiness,
    },
    {
      href: '/jobs?status=AT_RISK',
      label: 'At risk',
      value: kpis.atRiskJobs,
      tone: 'risk',
      icon: TriangleAlert,
    },
    {
      href: '/jobs?status=DELAYED',
      label: 'Behind schedule',
      value: kpis.delayedJobs,
      tone: 'late',
      icon: CalendarClock,
    },
    {
      href: '/dashboard#overview-triage',
      label: 'Past-due tasks',
      value: kpis.overdueSubtasks,
      tone: 'late',
      icon: Clock3,
    },
    {
      href: '/problems',
      label: 'Decisions pending',
      value: kpis.openProblems,
      tone: 'late',
      icon: Flag,
      note:
        kpis.openProblemsOlderThan24h > 0 ? `${kpis.openProblemsOlderThan24h} over 24h` : undefined,
    },
    {
      href: '/jobs?status=COMPLETED',
      label: 'Completed',
      value: kpis.completedThisMonth,
      tone: 'ok',
      icon: CircleCheck,
      scope: 'in range',
    },
  ];

  return (
    <div className="pulse-strip">
      {cells.map((cell) => (
        <Link key={cell.href} href={cell.href} className="pulse-cell">
          <span className="desktop-pulse-icon" data-tone={cell.tone} aria-hidden="true">
            <cell.icon className="size-4" />
          </span>
          <p className="flex items-baseline gap-1.5">
            <span className="text-muted-foreground text-xs">
              <T>{cell.label}</T>
            </span>
            {cell.scope ? (
              <span className="text-muted-foreground shrink-0 text-[10px]">{cell.scope}</span>
            ) : null}
          </p>
          <p className="mt-4 flex flex-wrap items-baseline gap-2">
            <span
              className={cn(
                'metric',
                cell.tone && cell.value > 0 ? textClass(cell.tone) : 'text-foreground',
              )}
            >
              {cell.value}
            </span>
            {cell.note ? <span className="text-late text-xs font-medium">{cell.note}</span> : null}
          </p>
        </Link>
      ))}
    </div>
  );
}
