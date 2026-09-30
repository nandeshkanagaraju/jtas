import Link from 'next/link';

import { formatDuration } from '@/lib/utils/duration';
import type { KpiCounts } from '@/lib/services/analytics';

/**
 * The six counts, as one line.
 *
 * Each count is still a link. A number the MD cannot open is a number he has
 * to go and look for. They sit under the two lists, in a lighter weight,
 * because they are not what he opened the page to decide.
 */

const LINK =
  'text-[#1c2430] underline decoration-[#d5dbe3] underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1c2430]';

export function KpiTiles({ kpis }: { kpis: KpiCounts }) {
  const waiting =
    kpis.openProblemsOlderThan24h > 0
      ? `, ${kpis.openProblemsOlderThan24h} waiting over ${formatDuration(24 * 60)}`
      : '';

  const items: { href: string; text: string }[] = [
    { href: '/jobs?status=active', text: `${kpis.activeJobs} active` },
    { href: '/jobs?status=AT_RISK', text: `${kpis.atRiskJobs} at risk` },
    { href: '/jobs?status=DELAYED', text: `${kpis.delayedJobs} delayed` },
    { href: '/jobs?filter=overdue', text: `${kpis.overdueSubtasks} overdue` },
    {
      href: '/problems',
      text: `${kpis.openProblems} open ${kpis.openProblems === 1 ? 'problem' : 'problems'}${waiting}`,
    },
    { href: '/jobs?status=COMPLETED', text: `${kpis.completedThisMonth} completed` },
  ];

  return (
    <p className="text-sm leading-7 text-[#1c2430]">
      {items.map((item, index) => (
        <span key={item.href}>
          {index > 0 ? ', ' : null}
          <Link href={item.href} className={LINK}>
            {item.text}
          </Link>
        </span>
      ))}
    </p>
  );
}
