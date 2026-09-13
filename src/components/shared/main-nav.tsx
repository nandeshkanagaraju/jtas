'use client';

import {
  AlertTriangle,
  BarChart3,
  Briefcase,
  ListTodo,
  ScrollText,
  Settings,
  Users,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

export interface NavItem {
  href: string;
  label: string;
  icon: 'jobs' | 'problems' | 'users' | 'my-tasks' | 'reports' | 'settings' | 'audit';
  /** Rendered as a count chip; omitted or zero shows nothing. */
  badge?: number;
  /** Draws the badge in red — used for problems older than a day. */
  badgeUrgent?: boolean;
}

const ICONS = {
  jobs: Briefcase,
  problems: AlertTriangle,
  users: Users,
  'my-tasks': ListTodo,
  reports: BarChart3,
  settings: Settings,
  audit: ScrollText,
} as const;

/**
 * The main navigation.
 *
 * The problem count is the only badge here, and that is deliberate: PDD
 * section 12 names "the MD does not clear the problem inbox" as a way this
 * product fails, and a number that will not go away is the cheapest possible
 * pressure against it. It turns red once anything has been waiting a day.
 */
export function MainNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();

  return (
    <nav className="flex items-center gap-0.5 overflow-x-auto" aria-label="Main">
      {items.map((item) => {
        const Icon = ICONS[item.icon];
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);

        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex min-h-11 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-sm transition-colors sm:px-3',
              active
                ? 'bg-accent text-foreground font-medium'
                : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
            )}
          >
            <Icon className="size-4" />
            <span className="hidden sm:inline">{item.label}</span>

            {item.badge && item.badge > 0 ? (
              <Badge
                className={cn(
                  'px-1.5 text-xs tabular-nums',
                  item.badgeUrgent
                    ? 'bg-state-overdue hover:bg-state-overdue text-white'
                    : 'bg-state-problem hover:bg-state-problem text-white',
                )}
              >
                {item.badge}
              </Badge>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
