import { expect, test } from '@playwright/test';

import { ACCOUNTS } from './fixtures/seed';
import { signIn } from './fixtures/ui';

test('manifest and app icons are accessible without authentication', async ({ request }) => {
  const response = await request.get('/manifest.webmanifest');
  expect(response.ok()).toBeTruthy();
  const manifest = await response.json();
  expect(manifest.display).toBe('standalone');
  expect(manifest.scope).toBe('/');
  expect(manifest.id).toBe('/my-tasks');
  expect(manifest.start_url).toBe('/');
  for (const icon of manifest.icons) {
    const image = await request.get(icon.src);
    expect(image.ok()).toBeTruthy();
    expect(image.headers()['content-type']).toContain('image/png');
  }
});

test('account provides a phone installation flow without claiming push is enabled', async ({
  page,
}) => {
  await signIn(page, ACCOUNTS.md);
  await page.goto('/account#install');
  await expect(page.getByRole('heading', { name: 'Jaraa on your phone' })).toBeVisible();
  await expect(page.getByText(/Installation does not enable phone push/)).toBeVisible();
  await page.evaluate(() => {
    const event = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
      prompt: async () => {},
      userChoice: Promise.resolve({ outcome: 'dismissed' }),
    });
    window.dispatchEvent(event);
  });
  await page.getByRole('button', { name: 'Install Jaraa' }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Installation cancelled' }),
  ).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('phone-installation.png'), fullPage: true });
});

test('service worker controls the page and caches the offline explanation', async ({ page }) => {
  await page.goto('/login');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await expect
    .poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)))
    .toBe(true);
  expect(
    await page.evaluate(async () => {
      const response = await caches.match('/offline');
      return response?.ok && (await response.text()).includes('No connection');
    }),
  ).toBe(true);
});

test('installed worker shows a useful fallback when the connection is lost', async ({
  page,
  context,
  browserName,
}) => {
  test.skip(
    browserName === 'webkit',
    'Playwright WebKit offline emulation fails navigation before the service worker fallback; verify on a physical Safari device.',
  );
  await page.goto('/login');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await expect
    .poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)))
    .toBe(true);
  await context.setOffline(true);
  await page.goto('/my-tasks');
  await expect(page.getByRole('heading', { name: /offline|connection/i })).toBeVisible();
  await context.setOffline(false);
});
