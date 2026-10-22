'use client';

import { ArrowUpRight, Menu, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';

import { AccountMenu } from '@/components/shared/account-menu';
import { Brand } from '@/components/shared/brand';
import {
  ADMIN_HREFS,
  NAV_ICONS,
  NAV_LABELS,
  sortPrimary,
  type NavItem,
} from '@/components/shared/main-nav';
import { NotificationBell } from '@/components/shared/notification-bell';
import { QuickNavigation } from '@/components/shared/quick-navigation';
import { ThemeToggle } from '@/components/shared/theme';
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from '@/components/ui/sheet';
import { cn } from '@/lib/utils';

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
  const [drawer, setDrawer] = useState(false);
  const pathname = usePathname();
  const primary = sortPrimary(nav.filter((item) => !ADMIN_HREFS.has(item.href)));
  const admin = nav.filter((item) => ADMIN_HREFS.has(item.href));

  function navLink(item: NavItem, mobile = false) {
    const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
    const Icon = NAV_ICONS[item.icon];
    return (
      <Link
        key={item.href}
        href={item.href}
        onClick={() => setDrawer(false)}
        aria-current={active ? 'page' : undefined}
        className={cn(mobile ? 'mobile-nav-link' : 'top-nav-link', active && 'is-active')}
      >
        <Icon className="size-4 shrink-0" strokeWidth={1.7} aria-hidden />
        <span>{NAV_LABELS[item.href] ?? item.label}</span>
        {item.badge && item.badge > 0 ? (
          <span className={cn('nav-count', item.badgeUrgent && 'is-urgent')}>
            {item.badge}
            <span className="sr-only"> open problems</span>
          </span>
        ) : null}
      </Link>
    );
  }

  return (
    <div className="app-canvas min-h-dvh">
      <a href="#content" className="skip-link">
        Skip to content
      </a>
      <div className="app-chrome sticky top-0 z-30">
        <header className="shell-width flex h-[76px] items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-7">
            <Link href="/" aria-label="Jaraa home">
              <Brand />
            </Link>
            <span className="text-muted-foreground hidden border-l pl-7 text-xs lg:block">
              Engineering operations
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-1.5 sm:gap-3">
            <QuickNavigation items={nav} />
            <span className="bg-border mx-1 hidden h-5 w-px sm:block" aria-hidden />
            <ThemeToggle compact />
            <NotificationBell initialUnread={unreadNotifications} />
            <div className="size-11">
              <AccountMenu name={name} email={email} role={role} collapsed />
            </div>
            <button
              type="button"
              aria-label="Menu"
              onClick={() => setDrawer(true)}
              className="header-icon lg:hidden"
            >
              <Menu className="size-5" />
            </button>
          </div>
        </header>
        <div className="border-border/60 border-t">
          <nav
            aria-label="Main"
            className="shell-width hidden min-h-[54px] items-stretch justify-between gap-4 lg:flex"
          >
            <div className="flex flex-wrap items-stretch gap-1 lg:gap-4">
              {primary.map((item) => navLink(item))}
            </div>
            {admin.length > 0 ? (
              <div className="flex flex-wrap items-stretch gap-1 border-l pl-4 lg:gap-3">
                {admin.map((item) => navLink(item))}
              </div>
            ) : null}
          </nav>
          <div className="shell-width flex min-h-11 items-center justify-between gap-3 lg:hidden">
            <span className="text-sm font-medium">
              {NAV_LABELS[`/${pathname.split('/')[1]}`] ?? 'Workspace'}
            </span>
            <span className="text-muted-foreground font-mono text-[11px]">Jaraa Global / JTAS</span>
          </div>
        </div>
      </div>
      <main
        id="content"
        tabIndex={-1}
        className="shell-width min-h-[calc(100dvh-130px)] py-7 pb-16 sm:py-10 lg:py-11"
      >
        <div key={pathname} className="route-enter w-full min-w-0">
          {children}
        </div>
      </main>
      <footer className="shell-width text-muted-foreground flex flex-wrap items-center justify-between gap-3 border-t py-6 text-xs">
        <span>Jaraa Global Engineering</span>
        <span className="inline-flex items-center gap-1.5">
          Task & accountability system <ArrowUpRight className="size-3" aria-hidden />
        </span>
      </footer>
      <Sheet open={drawer} onOpenChange={setDrawer}>
        <SheetContent
          side="right"
          showCloseButton={false}
          className="w-[min(100%,22rem)] gap-0 p-0"
        >
          <SheetTitle className="sr-only">Workspace navigation</SheetTitle>
          <SheetDescription className="sr-only">
            Navigate between your work, decisions and administration.
          </SheetDescription>
          <div className="flex items-center justify-between border-b p-5">
            <Brand />
            <SheetClose className="header-icon" aria-label="Close menu">
              <X className="size-5" />
            </SheetClose>
          </div>
          <nav aria-label="Mobile navigation" className="flex-1 space-y-1 overflow-y-auto p-4">
            {primary.map((item) => navLink(item, true))}
            {admin.length > 0 ? (
              <div className="mt-5 space-y-1 border-t pt-4">
                {admin.map((item) => navLink(item, true))}
              </div>
            ) : null}
          </nav>
          <div className="space-y-4 border-t p-5">
            <ThemeToggle />
            <AccountMenu name={name} email={email} role={role} />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
