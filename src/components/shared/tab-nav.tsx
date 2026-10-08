import Link from 'next/link';

import { cn } from '@/lib/utils';

export interface TabItem {
  href: string;
  label: string;
  /** Matched against `current`, so a tab can keep its identity across queries. */
  id: string;
}

/**
 * Link tabs for a screen with two or three views behind one URL.
 *
 * Reports and Settings each had their own copy of this, with the same
 * underline and two different paddings. The underline sits on the tab rather
 * than under the whole row so the active view is marked without a second
 * colour, and `aria-current` carries it for anyone not looking at the line.
 */
export function TabNav({
  tabs,
  current,
  label,
  className,
}: {
  tabs: readonly TabItem[];
  current: string;
  label: string;
  className?: string;
}) {
  return (
    <nav
      aria-label={label}
      className={cn('border-border flex gap-1 overflow-x-auto border-b', className)}
    >
      {tabs.map((tab) => {
        const active = tab.id === current;
        return (
          <Link
            key={tab.id}
            href={tab.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              '-mb-px shrink-0 border-b-2 px-3 py-2.5 text-sm whitespace-nowrap transition-colors',
              active
                ? 'border-primary text-foreground font-semibold'
                : 'text-muted-foreground hover:text-foreground hover:border-border border-transparent',
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
