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
    <div className="flex min-h-dvh bg-[#14171e] text-[#f3f5f8]">
      <aside
        className={cn(
          'sticky top-0 hidden h-dvh shrink-0 flex-col overflow-hidden border-r border-[#313743] bg-[#101216] lg:flex',
          collapsed ? 'w-[4.75rem] max-w-[4.75rem]' : 'w-60 max-w-60',
        )}
      >
        <div
          className={cn(
            'flex h-16 items-center',
            collapsed ? 'justify-center px-1' : 'justify-between px-4',
          )}
        >
          <Brand collapsed={collapsed} />
          {collapsed ? null : (
            <button
              type="button"
              onClick={toggleCollapsed}
              aria-label="Collapse sidebar"
              className="focus-visible:outline-ring inline-flex size-11 items-center justify-center rounded-lg text-[#aeb6c3] hover:bg-[#1e222b] hover:text-[#f3f5f8] focus-visible:outline-2 focus-visible:outline-offset-2"
            >
              <PanelLeftClose className="size-5" />
            </button>
          )}
        </div>
        {collapsed ? (
          <div className="flex justify-center pb-2">
            <button
              type="button"
              onClick={toggleCollapsed}
              aria-label="Expand sidebar"
              className="focus-visible:outline-ring inline-flex size-11 items-center justify-center rounded-lg text-[#aeb6c3] hover:bg-[#1e222b] hover:text-[#f3f5f8] focus-visible:outline-2 focus-visible:outline-offset-2"
            >
              <PanelLeftOpen className="size-5" />
            </button>
          </div>
        ) : null}
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3 py-2">
          <NavList items={primary} admin={admin} collapsed={collapsed} />
        </div>
        <div className="border-t border-[#313743] p-3">
          <AccountMenu name={name} email={email} role={role} collapsed={collapsed} />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex h-14 items-center gap-3 border-b border-[#313743] bg-[#14171e] px-4 sm:px-8">
          <button
            type="button"
            onClick={() => setDrawer(true)}
            aria-label="Menu"
            className="focus-visible:outline-ring inline-flex size-11 items-center justify-center rounded-lg text-[#aeb6c3] hover:bg-[#1e222b] hover:text-[#f3f5f8] focus-visible:outline-2 focus-visible:outline-offset-2 lg:hidden"
          >
            <Menu className="size-5" />
          </button>
          <Crumb />
          <div className="ml-auto">
            <NotificationBell initialUnread={unreadNotifications} />
          </div>
        </header>
        <main className="flex-1 px-4 py-6 sm:px-8 sm:py-8">{children}</main>
      </div>

      <Sheet open={drawer} onOpenChange={setDrawer}>
        <SheetContent
          side="left"
          showCloseButton={false}
          className="w-72 max-w-[18rem] translate-x-0 gap-0 border-[#313743] bg-[#101216] p-0 text-[#f3f5f8] shadow-none data-[state=open]:translate-x-0"
        >
          <div className="flex h-16 items-center justify-between pr-1 pl-4">
            <Brand />
            <SheetClose className="focus-visible:outline-ring inline-flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm font-medium text-[#f3f5f8] focus-visible:outline-2 focus-visible:outline-offset-2">
              <X className="size-4" />
              Close
            </SheetClose>
          </div>
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3 py-2">
            <NavList items={primary} admin={admin} onNavigate={() => setDrawer(false)} />
          </div>
          <div className="border-t border-[#313743] p-3">
            <AccountMenu name={name} email={email} role={role} />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

function Brand({ collapsed = false }: { collapsed?: boolean }) {
  return (
    <div className={cn('flex min-w-0 items-center gap-2.5', collapsed && 'justify-center')}>
      <span className="font-display inline-flex size-8 shrink-0 items-center justify-center rounded-md bg-[#d6f25a] text-sm font-bold text-[#14180a]">
        J
      </span>
      {collapsed ? null : (
        <span className="min-w-0">
          <span className="font-display block truncate text-sm leading-none font-semibold tracking-[-0.03em] text-[#f3f5f8]">
            JTAS
          </span>
          <span className="mt-1 block truncate font-mono text-[10px] tracking-[0.18em] text-[#aeb6c3] uppercase">
            Jaraa
          </span>
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
    <div className="min-w-0">
      <p className="font-mono text-[10px] tracking-[0.18em] text-[#aeb6c3] uppercase">
        JTAS / {segment || 'home'}
      </p>
      <p className="font-display truncate text-base leading-tight font-semibold tracking-[-0.03em] text-[#f3f5f8]">
        {title}
      </p>
    </div>
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
    <nav aria-label="Main" className="flex flex-col gap-1">
      <p
        className={cn(
          'px-3 pt-2 pb-1 font-mono text-[10px] tracking-[0.18em] text-[#aeb6c3] uppercase',
          collapsed && 'sr-only',
        )}
      >
        Daily
      </p>
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
        <div className="mt-4 flex flex-col gap-1 border-t border-[#313743] pt-4">
          <p
            className={cn(
              'px-3 pb-1 font-mono text-[10px] tracking-[0.18em] text-[#aeb6c3] uppercase',
              collapsed && 'sr-only',
            )}
          >
            Manage
          </p>
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
    ? 'bg-[#fb7185]/15 text-[#fb7185]'
    : 'bg-[#d6f25a]/15 text-[#d6f25a]';

  return (
    <Link
      href={item.href}
      aria-current={active ? 'page' : undefined}
      aria-label={count ? `${item.label}, ${count}` : undefined}
      onClick={onNavigate}
      title={collapsed ? item.label : undefined}
      className={cn(
        'focus-visible:outline-ring flex min-h-11 rounded-md text-sm focus-visible:outline-2 focus-visible:outline-offset-2',
        collapsed
          ? 'flex-col items-center justify-center gap-1 px-1 py-2'
          : 'items-center gap-3 px-3',
        active
          ? 'bg-[#d6f25a]/15 font-medium text-[#d6f25a]'
          : 'text-[#aeb6c3] hover:bg-[#1e222b] hover:text-[#f3f5f8]',
      )}
    >
      <Icon className="size-5 shrink-0" />
      {collapsed ? (
        count ? (
          <span
            className={cn(
              'rounded-full px-1.5 font-mono text-[11px] leading-none font-medium',
              countClass,
            )}
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
                'rounded-full px-2 py-0.5 font-mono text-[11px] font-medium',
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
