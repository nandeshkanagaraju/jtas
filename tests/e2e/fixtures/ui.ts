/**
 * Small helpers for driving the parts of the UI that are not a plain input.
 */
import { expect, type Page } from '@playwright/test';

import { E2E_PASSWORD } from './seed';

/** Signs in, clearing any previous session first. */
export async function signIn(page: Page, email: string): Promise<void> {
  await page.context().clearCookies();
  await page.goto('/login');
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(E2E_PASSWORD);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 30_000 });
}

const ORDINALS: Record<number, string> = { 1: 'st', 2: 'nd', 3: 'rd' };

/** "Friday, October 16th, 2026" — the aria-label react-day-picker gives a day. */
function dayLabel(date: Date): string {
  const weekday = date.toLocaleDateString('en-US', { weekday: 'long' });
  const month = date.toLocaleDateString('en-US', { month: 'long' });
  const day = date.getDate();
  const teen = day % 100 >= 11 && day % 100 <= 13;
  const suffix = teen ? 'th' : (ORDINALS[day % 10] ?? 'th');

  return `${weekday}, ${month} ${day}${suffix}, ${date.getFullYear()}`;
}

/**
 * Picks a date and a time in an `IstDateTimePicker`.
 *
 * The control is a calendar popover plus a time select, not a text field, so a
 * `fill()` has nothing to fill. Clicking through it is also the only way the
 * suite exercises the 18:00 default the picker applies on first selection.
 *
 * `date` is read as a local date — the picker's own IST conversion is what is
 * under test, so the spec must not do any of it in advance.
 */
export async function pickIstDateTime(
  page: Page,
  label: string | RegExp,
  date: Date,
  time = '18:00',
): Promise<void> {
  // A string is matched exactly; several of these labels carry a parenthetical
  // ("New deadline (currently 12 Oct 2026, 06:00 PM)"), which a regex handles.
  await page.getByRole('button', { name: label, exact: typeof label === 'string' }).click();

  const grid = page.getByRole('grid');
  await expect(grid).toBeVisible();

  const wanted = date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const next = page.getByRole('button', { name: /next month/i });

  // Bounded: twelve clicks is a year, and a runaway loop here would otherwise
  // read as a mysterious timeout.
  for (let i = 0; i < 12; i++) {
    if (
      await page
        .getByText(wanted, { exact: true })
        .isVisible()
        .catch(() => false)
    )
      break;
    await next.click();
  }

  await grid.getByRole('button', { name: dayLabel(date), exact: true }).click();

  // Selecting a date defaults the time to 18:00; set it only when it differs.
  if (time !== '18:00') {
    await page.getByRole('combobox', { name: 'Time (IST)' }).click();
    await page.getByRole('option', { name: time, exact: true }).click();
  }

  await page.keyboard.press('Escape');
}
