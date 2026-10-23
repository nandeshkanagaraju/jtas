'use client';

import { LocalizedElement } from '@/lib/i18n/provider';

import { T } from '@/lib/i18n/provider';

import { ArrowLeft, ArrowUpRight, Bell, Menu, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';

import { LanguageSelector } from '@/lib/i18n/provider';

import { PushLanguageSync } from '@/components/shared/push-language-sync';
import { AccountMenu } from '@/components/shared/account-menu';
import { Brand } from '@/components/shared/brand';
import { usePhoneApp } from '@/components/shared/phone-app';
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
  const phone = usePhoneApp();
  const primary = sortPrimary(nav.filter((item) => !ADMIN_HREFS.has(item.href)));
  const admin = nav.filter((item) => ADMIN_HREFS.has(item.href));
  const tabOrder =
    role === 'MD' || role === 'DEPUTY_MD'
      ? ['/dashboard', '/jobs', '/problems']
      : role === 'ADMIN'
        ? ['/users', '/my-tasks']
        : ['/my-tasks', '/jobs'];
  const phoneTabs = tabOrder.flatMap((href) => nav.find((item) => item.href === href) ?? []);
  const backHref = pathname.startsWith('/tasks/')
    ? '/my-tasks'
    : pathname.startsWith('/jobs/') && nav.some((item) => item.href === '/jobs')
      ? '/jobs'
      : pathname.startsWith('/settings/') && nav.some((item) => item.href === '/settings')
        ? '/settings'
        : null;
  const currentTab = (href: string) =>
    pathname === href ||
    pathname.startsWith(`${href}/`) ||
    (href === '/my-tasks' && pathname.startsWith('/tasks/'));

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
        <span>
          <T>{NAV_LABELS[item.href] ?? item.label}</T>
        </span>
        {item.badge && item.badge > 0 ? (
          <span className={cn('nav-count', item.badgeUrgent && 'is-urgent')}>
            {item.badge}
            <span className="sr-only">
              {' '}
              <T>{' open problems'}</T>
            </span>
          </span>
        ) : null}
      </Link>
    );
  }

  return (
    <div className="app-canvas min-h-dvh" data-phone-app={phone ? 'true' : undefined}>
      <PushLanguageSync />
      <a href="#content" className="skip-link">
        <T>{'Skip to content '}</T>
      </a>
      {phone ? (
        <header className="phone-app-header sticky top-0 z-30">
          <div className="flex min-w-0 items-center gap-2">
            {backHref ? (
              <Link href={backHref} aria-label="Back to list" className="header-icon">
                <ArrowLeft className="size-5" />
              </Link>
            ) : (
              <Link href="/" aria-label="Jaraa home">
                <Brand compact />
              </Link>
            )}
            <span className="truncate text-sm font-semibold">
              <T>
                {pathname.startsWith('/tasks/')
                  ? 'Task'
                  : (NAV_LABELS[`/${pathname.split('/')[1]}`] ?? 'Jaraa')}
              </T>
            </span>
          </div>
          <NotificationBell initialUnread={unreadNotifications} />
        </header>
      ) : null}
      {!phone ? (
        <div className="web-app-chrome app-chrome sticky top-0 z-30">
          <header className="shell-width flex h-[76px] items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-7">
              <Link href="/" aria-label="Jaraa home">
                <Brand />
              </Link>
              <span className="text-muted-foreground hidden border-l pl-7 text-xs lg:block">
                <T>{'Engineering operations '}</T>
              </span>
            </div>
            <div className="flex shrink-0 items-center gap-1.5 sm:gap-3">
              <QuickNavigation items={nav} />
              <LanguageSelector compact />
              <span className="bg-border mx-1 hidden h-5 w-px sm:block" aria-hidden />
              <ThemeToggle compact />
              <NotificationBell initialUnread={unreadNotifications} />
              <div className="size-11">
                <AccountMenu name={name} email={email} role={role} collapsed />
              </div>
              <LocalizedElement
                as="button"
                type="button"
                aria-label="Menu"
                onClick={() => setDrawer(true)}
                className="header-icon lg:hidden"
              >
                <Menu className="size-5" />
              </LocalizedElement>
            </div>
          </header>
          <div className="border-border/60 border-t">
            <LocalizedElement
              as="nav"
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
            </LocalizedElement>
            <div className="shell-width flex min-h-11 items-center justify-between gap-3 lg:hidden">
              <span className="text-sm font-medium">
                <T>{NAV_LABELS[`/${pathname.split('/')[1]}`] ?? 'Workspace'}</T>
              </span>
              <span className="text-muted-foreground font-mono text-[11px]">
                <T>{'Jaraa Global / JTAS '}</T>
              </span>
            </div>
          </div>
        </div>
      ) : null}
      <main
        id="content"
        tabIndex={-1}
        className="shell-width min-h-[calc(100dvh-130px)] py-7 pb-16 sm:py-10 lg:py-11"
      >
        <div key={pathname} className="route-enter w-full min-w-0">
          {children}
        </div>
      </main>
      <footer className="web-app-footer shell-width text-muted-foreground flex flex-wrap items-center justify-between gap-3 border-t py-6 text-xs">
        <span>
          <T>{'Jaraa Global Engineering'}</T>
        </span>
        <span className="inline-flex items-center gap-1.5">
          <T>{'Task & accountability system '}</T>
          <ArrowUpRight className="size-3" aria-hidden />
        </span>
      </footer>
      {phone ? (
        <LocalizedElement as="nav" aria-label="App navigation" className="phone-app-tabs">
          {phoneTabs.map((item) => {
            const Icon = NAV_ICONS[item.icon];
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={currentTab(item.href) ? 'page' : undefined}
              >
                <span className="relative">
                  <Icon className="size-5" aria-hidden />
                  {item.badge && item.badge > 0 ? (
                    <span className="phone-tab-badge">
                      {item.badge}
                      <span className="sr-only">
                        {' '}
                        <T>{' open problems'}</T>
                      </span>
                    </span>
                  ) : null}
                </span>
                <span>
                  <T>{item.href === '/jobs' ? 'Jobs' : (NAV_LABELS[item.href] ?? item.label)}</T>
                </span>
              </Link>
            );
          })}
          {phoneTabs.length < 3 ? (
            <Link
              href="/notifications"
              aria-current={pathname === '/notifications' ? 'page' : undefined}
            >
              <Bell className="size-5" aria-hidden />
              <span>
                <T>{'Alerts'}</T>
              </span>
            </Link>
          ) : null}
          <LocalizedElement
            as="button"
            type="button"
            onClick={() => setDrawer(true)}
            aria-label="More"
            aria-expanded={drawer}
          >
            <Menu className="size-5" aria-hidden />
            <span>
              <T>{'More'}</T>
            </span>
          </LocalizedElement>
        </LocalizedElement>
      ) : null}
      <Sheet open={drawer} onOpenChange={setDrawer}>
        <SheetContent
          side="right"
          showCloseButton={false}
          className="w-[min(100%,22rem)] gap-0 p-0"
        >
          <SheetTitle className="sr-only">
            <T>{'Workspace navigation'}</T>
          </SheetTitle>
          <SheetDescription className="sr-only">
            <T>{'Navigate between your work, decisions and administration. '}</T>
          </SheetDescription>
          <div className="flex items-center justify-between border-b p-5">
            <Brand />
            <SheetClose className="header-icon" aria-label="Close menu">
              <X className="size-5" />
            </SheetClose>
          </div>
          <LocalizedElement
            as="nav"
            aria-label="Mobile navigation"
            className="flex-1 space-y-1 overflow-y-auto p-4"
          >
            {phone ? (
              <div className="mb-3">
                <QuickNavigation items={nav} mobile onNavigate={() => setDrawer(false)} />
              </div>
            ) : null}
            {primary.map((item) => navLink(item, true))}
            {admin.length > 0 ? (
              <div className="mt-5 space-y-1 border-t pt-4">
                {admin.map((item) => navLink(item, true))}
              </div>
            ) : null}
          </LocalizedElement>
          <div className="space-y-4 border-t p-5">
            <LanguageSelector />
            <ThemeToggle />
            <AccountMenu name={name} email={email} role={role} />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
