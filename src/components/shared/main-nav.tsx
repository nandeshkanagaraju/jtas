import {
  AlertTriangle,
  BarChart3,
  Briefcase,
  LayoutDashboard,
  ListTodo,
  ScrollText,
  Settings,
  Users,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  href: string;
  label: string;
  icon: 'dashboard' | 'jobs' | 'problems' | 'users' | 'my-tasks' | 'reports' | 'settings' | 'audit';
  /** Open-problem count. Omitted or zero shows nothing. */
  badge?: number;
  /** The count is late-red once anything has been waiting a day. */
  badgeUrgent?: boolean;
}

export const NAV_ICONS: Record<NavItem['icon'], LucideIcon> = {
  dashboard: LayoutDashboard,
  jobs: Briefcase,
  problems: AlertTriangle,
  users: Users,
  'my-tasks': ListTodo,
  reports: BarChart3,
  settings: Settings,
  audit: ScrollText,
};

/** Daily routes, in the order the MD sees them. Members simply lack some. */
export const PRIMARY_ORDER = ['/dashboard', '/problems', '/jobs', '/my-tasks', '/reports'] as const;

export const ADMIN_HREFS = new Set(['/users', '/audit', '/settings']);

export function sortPrimary(items: NavItem[]): NavItem[] {
  return [...items].sort(
    (a, b) =>
      PRIMARY_ORDER.indexOf(a.href as (typeof PRIMARY_ORDER)[number]) -
      PRIMARY_ORDER.indexOf(b.href as (typeof PRIMARY_ORDER)[number]),
  );
}
