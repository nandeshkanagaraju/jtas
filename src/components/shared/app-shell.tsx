'use client';

import { Menu, PanelLeftClose, PanelLeftOpen, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

import { AccountMenu } from '@/components/shared/account-menu';
import { ADMIN_HREFS, NAV_ICONS, sortPrimary, type NavItem } from '@/components/shared/main-nav';
import { NotificationBell } from '@/components/shared/notification-bell';
import { Sheet, SheetClose, SheetContent } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';

const CRUMB: Record<string, string> = {
  dashboard: 'Dashboard',
  jobs: 'Jobs',
  problems: 'Problems',
  reports: 'Reports',
  'my-tasks': 'My tasks',
  users: 'Users',
  audit: 'Audit',
  settings: 'Settings',
  notifications: 'Notifications',
};

const COLLAPSED_KEY = 'jtas-sidebar';

/**
 * Sidebar, header, then the page.
 *
 * The sidebar is the quietest surface in the app: it sits a shade below the
 * canvas so the work in the middle comes forward, and the active route is a
 * white tile with an accent rule down its leading edge rather than a block of
 * colour. One thing is highlighted at a time, and it is always where you are.
 *
 * Below 1024px the sidebar is a drawer with a Close button. Collapsed, a
 * route is an icon with its count underneath — the number is its own line,
 * not a badge sitting on the icon.
 */
export function AppShell({
  name,
  email,
  role,
  nav,
  unreadNotifications,
  children,
}: {
  name: string;
  email: string;
  role: string;
  nav: NavItem[];
  unreadNotifications: number;
  children: React.ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const primary = sortPrimary(nav.filter((item) => !ADMIN_HREFS.has(item.href)));
  const admin = nav.filter((item) => ADMIN_HREFS.has(item.href));

  useEffect(() => {
    setCollapsed(window.localStorage.getItem(COLLAPSED_KEY) === '1');
  }, []);

  function toggleCollapsed() {
    setCollapsed((value) => {
      window.localStorage.setItem(COLLAPSED_KEY, value ? '0' : '1');
      return !value;
    });
  }

  return (
    <div className="bg-background text-foreground flex min-h-dvh">
      <aside
        className={cn(
          'border-sidebar-border bg-sidebar sticky top-0 hidden h-dvh shrink-0 flex-col overflow-hidden border-r lg:flex',
          collapsed ? 'w-[4.5rem] max-w-[4.5rem]' : 'w-[15rem] max-w-[15rem]',
        )}
      >
        <div
          className={cn(
            'flex h-14 items-center',
            collapsed ? 'justify-center px-1' : 'justify-between pr-2 pl-4',
          )}
        >
          <Brand collapsed={collapsed} />
          {collapsed ? null : <CollapseButton label="Collapse sidebar" onClick={toggleCollapsed} />}
        </div>
        {collapsed ? (
          <div className="flex justify-center pb-1">
            <CollapseButton label="Expand sidebar" onClick={toggleCollapsed} expand />
          </div>
        ) : null}
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-2.5 py-2">
          <NavList items={primary} admin={admin} collapsed={collapsed} />
        </div>
        <div className="border-sidebar-border border-t p-2.5">
          <AccountMenu name={name} email={email} role={role} collapsed={collapsed} />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="border-border bg-background/90 sticky top-0 z-10 flex h-14 items-center gap-2 border-b px-4 backdrop-blur-sm sm:px-6">
          <button
            type="button"
            onClick={() => setDrawer(true)}
            aria-label="Menu"
            className="text-muted-foreground hover:bg-muted hover:text-foreground -ml-2 inline-flex size-11 items-center justify-center rounded-md transition-colors lg:hidden"
          >
            <Menu className="size-5" />
          </button>
          <Crumb />
          <div className="ml-auto">
            <NotificationBell initialUnread={unreadNotifications} />
          </div>
        </header>
        <main className="mx-auto w-full max-w-[90rem] flex-1 px-4 py-6 sm:px-6 sm:py-8">
          {children}
        </main>
      </div>

      <Sheet open={drawer} onOpenChange={setDrawer}>
        <SheetContent
          side="left"
          showCloseButton={false}
          className="bg-sidebar border-sidebar-border text-foreground w-[17rem] max-w-[17rem] translate-x-0 gap-0 p-0 shadow-none data-[state=open]:translate-x-0"
        >
          <div className="border-sidebar-border flex h-14 items-center justify-between border-b pr-2 pl-4">
            <Brand />
            <SheetClose className="text-muted-foreground hover:text-foreground inline-flex min-h-11 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium transition-colors">
              <X className="size-4" />
              Close
            </SheetClose>
          </div>
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-2.5 py-2">
            <NavList items={primary} admin={admin} onNavigate={() => setDrawer(false)} />
          </div>
          <div className="border-sidebar-border border-t p-2.5">
            <AccountMenu name={name} email={email} role={role} />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

function CollapseButton({
  label,
  onClick,
  expand = false,
}: {
  label: string;
  onClick: () => void;
  expand?: boolean;
}) {
  const Icon = expand ? PanelLeftOpen : PanelLeftClose;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="text-muted-foreground hover:bg-sidebar-hover hover:text-foreground inline-flex size-9 items-center justify-center rounded-md transition-colors"
    >
      <Icon className="size-[18px]" />
    </button>
  );
}

function Brand({ collapsed = false }: { collapsed?: boolean }) {
  return (
    <div className={cn('flex min-w-0 items-center gap-2.5', collapsed && 'justify-center')}>
      <span className="bg-primary text-primary-foreground font-display inline-flex size-7 shrink-0 items-center justify-center rounded-md text-[13px] font-bold">
        J
      </span>
      {collapsed ? null : (
        <span className="min-w-0">
          <span className="font-display block truncate text-sm leading-none font-semibold tracking-[-0.02em]">
            JTAS
          </span>
          <span className="eyebrow mt-1 block truncate">Jaraa Global</span>
        </span>
      )}
    </div>
  );
}

function Crumb() {
  const pathname = usePathname();
  const segment = pathname.split('/').filter(Boolean)[0] ?? '';
  const title = CRUMB[segment] ?? 'JTAS';
  return (
    <p className="font-display min-w-0 truncate text-sm leading-tight font-semibold">{title}</p>
  );
}

function NavList({
  items,
  admin,
  collapsed = false,
  onNavigate,
}: {
  items: NavItem[];
  admin: NavItem[];
  collapsed?: boolean;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();

  return (
    <nav aria-label="Main" className="flex flex-col gap-0.5">
      <p className={cn('eyebrow px-2.5 pt-2 pb-1.5', collapsed && 'sr-only')}>Daily</p>
      {items.map((item) => (
        <NavLink
          key={item.href}
          item={item}
          pathname={pathname}
          collapsed={collapsed}
          onNavigate={onNavigate}
        />
      ))}
      {admin.length > 0 ? (
        <div className="border-sidebar-border mt-3 flex flex-col gap-0.5 border-t pt-3">
          <p className={cn('eyebrow px-2.5 pb-1.5', collapsed && 'sr-only')}>Manage</p>
          {admin.map((item) => (
            <NavLink
              key={item.href}
              item={item}
              pathname={pathname}
              collapsed={collapsed}
              onNavigate={onNavigate}
            />
          ))}
        </div>
      ) : null}
    </nav>
  );
}

function NavLink({
  item,
  pathname,
  collapsed,
  onNavigate,
}: {
  item: NavItem;
  pathname: string;
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  const Icon = NAV_ICONS[item.icon];
  const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
  const count = item.badge && item.badge > 0 ? item.badge : null;
  const countClass = item.badgeUrgent
    ? 'bg-late-soft text-late border border-late-edge'
    : 'bg-muted text-muted-foreground border border-border';

  return (
    <Link
      href={item.href}
      aria-current={active ? 'page' : undefined}
      aria-label={count ? `${item.label}, ${count}` : undefined}
      onClick={onNavigate}
      title={collapsed ? item.label : undefined}
      className={cn(
        'relative flex min-h-10 rounded-md text-sm transition-colors',
        collapsed
          ? 'flex-col items-center justify-center gap-1 px-1 py-2'
          : 'items-center gap-2.5 px-2.5',
        active
          ? 'bg-sidebar-active text-foreground font-semibold'
          : 'text-muted-foreground hover:bg-sidebar-hover hover:text-foreground',
      )}
    >
      {/* The accent lives on a 2px rule, not on the whole tile. */}
      {active ? (
        <span aria-hidden className="bg-primary absolute inset-y-1.5 left-0 w-[2px] rounded-full" />
      ) : null}
      <Icon className={cn('size-[18px] shrink-0', active && 'text-primary')} strokeWidth={1.75} />
      {collapsed ? (
        count ? (
          <span
            className={cn('rounded px-1 font-mono text-[10px] leading-4 font-medium', countClass)}
          >
            {count}
          </span>
        ) : null
      ) : (
        <>
          <span className="min-w-0 flex-1 truncate">{item.label}</span>
          {count ? (
            <span
              className={cn(
                'rounded px-1.5 font-mono text-[11px] leading-5 font-medium tabular-nums',
                countClass,
              )}
            >
              {count}
            </span>
          ) : null}
        </>
      )}
    </Link>
  );
}
