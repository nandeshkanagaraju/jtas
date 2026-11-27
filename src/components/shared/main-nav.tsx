import {
  AlertTriangle,
  Boxes,
  BarChart3,
  Briefcase,
  ClipboardList,
  LayoutDashboard,
  ListTodo,
  ReceiptIndianRupee,
  ScrollText,
  Settings,
  Users,
  Radio,
  KeyRound,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  href: string;
  label: string;
  icon:
    | 'dashboard'
    | 'jobs'
    | 'problems'
    | 'users'
    | 'my-tasks'
    | 'reports'
    | 'settings'
    | 'audit'
    | 'updates'
    | 'billing'
    | 'stock'
    | 'shift-reports'
    | 'sign-in';
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
  updates: Radio,
  billing: ReceiptIndianRupee,
  stock: Boxes,
  'shift-reports': ClipboardList,
  'sign-in': KeyRound,
};

/** Daily routes, in the order the MD sees them. Members simply lack some. */
export const PRIMARY_ORDER = [
  '/dashboard',
  '/jobs',
  '/production',
  '/billing',
  '/stock',
  '/updates',
  '/problems',
  '/my-tasks',
  '/reports',
] as const;

export const ADMIN_HREFS = new Set(['/users', '/sign-in-requests', '/audit', '/settings']);

export function sortPrimary(items: NavItem[]): NavItem[] {
  return [...items].sort(
    (a, b) =>
      PRIMARY_ORDER.indexOf(a.href as (typeof PRIMARY_ORDER)[number]) -
      PRIMARY_ORDER.indexOf(b.href as (typeof PRIMARY_ORDER)[number]),
  );
}

export const NAV_LABELS: Record<string, string> = {
  '/dashboard': 'Overview',
  '/jobs': 'Production',
  '/problems': 'Decisions',
  '/my-tasks': 'My work',
  '/reports': 'Insights',
  '/users': 'People',
  '/audit': 'Activity log',
  '/settings': 'Settings',
  '/account': 'Your account',
  '/tasks': 'My work',
  '/notifications': 'Notifications',
  '/updates': 'Live updates',
  '/billing': 'Billing',
  '/stock': 'Stock',
  '/production': 'Shift reports',
  '/sign-in-requests': 'Sign-in requests',
};
