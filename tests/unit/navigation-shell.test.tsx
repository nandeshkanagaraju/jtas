/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppShell } from '@/components/shared/app-shell';
import { ThemeToggle } from '@/components/shared/theme';

const { setTheme } = vi.hoisted(() => ({ setTheme: vi.fn() }));
vi.mock('next/navigation', () => ({ usePathname: () => '/jobs/job-1' }));
vi.mock('next-themes', () => ({ useTheme: () => ({ theme: 'system', setTheme }) }));
vi.mock('@/components/shared/notification-bell', () => ({
  NotificationBell: () => <a href="/notifications">Notifications</a>,
}));
vi.mock('@/components/shared/account-menu', () => ({
  AccountMenu: () => <button>Account</button>,
}));
afterEach(cleanup);
beforeEach(() => setTheme.mockReset());

function Shell() {
  return (
    <AppShell
      name="Member"
      email="member@example.com"
      role="MEMBER"
      nav={[
        { href: '/jobs', label: 'Production', icon: 'jobs' },
        { href: '/my-tasks', label: 'My work', icon: 'my-tasks' },
      ]}
      unreadNotifications={0}
    >
      <h1>Current job</h1>
    </AppShell>
  );
}

describe('horizontal workspace navigation', () => {
  it('keeps the current route and only the granted destinations in navigation', () => {
    render(<Shell />);
    const navigation = screen.getByRole('navigation', { name: 'Main' });
    expect(
      within(navigation).getByRole('link', { name: 'Production' }).getAttribute('aria-current'),
    ).toBe('page');
    expect(within(navigation).getByRole('link', { name: 'My work' }).getAttribute('href')).toBe(
      '/my-tasks',
    );
    expect(within(navigation).queryByRole('link', { name: 'People' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Skip to content' }).getAttribute('href')).toBe(
      '#content',
    );
  });
  it('exposes the same destinations in the phone menu', () => {
    render(<Shell />);
    fireEvent.click(screen.getByRole('button', { name: 'Menu' }));
    const drawer = screen.getByRole('dialog');
    expect(within(drawer).getByRole('link', { name: 'Production' }).getAttribute('href')).toBe(
      '/jobs',
    );
    expect(within(drawer).getByRole('link', { name: 'My work' }).getAttribute('href')).toBe(
      '/my-tasks',
    );
    fireEvent.click(within(drawer).getByRole('button', { name: 'Close menu' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  it('keeps theme switching available directly from the compact header', () => {
    render(<ThemeToggle compact />);
    fireEvent.click(screen.getByRole('button', { name: 'Theme: Auto. Switch to Night' }));
    expect(setTheme).toHaveBeenCalledWith('dark');
  });
});
