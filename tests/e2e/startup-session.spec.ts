import { expect, test } from '@playwright/test';
import { ACCOUNTS } from './fixtures/seed';
import { signIn } from './fixtures/ui';

test('first app navigation refreshes an expired access session and opens the task list', async ({
  page,
  context,
}) => {
  await signIn(page, ACCOUNTS.planning);
  await context.clearCookies({ name: 'jtas_at' });
  const before = (await context.cookies()).find((cookie) => cookie.name === 'jtas_rt')!.value;
  const origins: string[] = [];
  page.on('request', (request) => {
    if (request.isNavigationRequest()) origins.push(new URL(request.url()).origin);
  });
  await page.goto('/');
  await expect(page).toHaveURL('http://localhost:3101/my-tasks');
  await expect(page.getByRole('heading', { name: 'My work', exact: true })).toBeVisible();
  const cookies = await context.cookies();
  expect(cookies.find((cookie) => cookie.name === 'jtas_at')?.value).toBeTruthy();
  expect(cookies.find((cookie) => cookie.name === 'jtas_rt')?.value).not.toBe(before);
  expect(origins.every((origin) => origin === 'http://localhost:3101')).toBe(true);
});

test('first app navigation with a stale refresh cookie reaches login on the public origin', async ({
  page,
  context,
}) => {
  await context.addCookies([
    { name: 'jtas_rt', value: 'expired-or-invalid', url: 'http://localhost:3101' },
  ]);
  const origins: string[] = [];
  page.on('request', (request) => {
    if (request.isNavigationRequest()) origins.push(new URL(request.url()).origin);
  });
  await page.goto('/updates?job=test-link');
  await expect(page).toHaveURL('http://localhost:3101/login?next=%2Fupdates%3Fjob%3Dtest-link');
  await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
  expect((await context.cookies()).some((cookie) => cookie.name === 'jtas_rt')).toBe(false);
  expect(origins.every((origin) => origin === 'http://localhost:3101')).toBe(true);
});
