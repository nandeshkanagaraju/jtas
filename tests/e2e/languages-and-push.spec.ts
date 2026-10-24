import { expect, test } from '@playwright/test';
import { ACCOUNTS } from './fixtures/seed';
import { signIn } from './fixtures/ui';

for (const language of [
  {
    code: 'ta',
    language: 'மொழி',
    signIn: 'உள்நுழையவும்',
    work: 'எனது பணிகள்',
    account: 'உங்கள் கணக்கு',
    start: 'பணியைத் தொடங்கவும்',
  },
  {
    code: 'hi',
    language: 'भाषा',
    signIn: 'साइन इन करें',
    work: 'मेरा काम',
    account: 'आपका खाता',
    start: 'काम शुरू करें',
  },
]) {
  test(`${language.code}: language persists across login, navigation and reload`, async ({
    page,
  }) => {
    await page.goto('/login');
    await page.getByLabel('Language').selectOption(language.code);
    await expect(page.locator('html')).toHaveAttribute('lang', language.code);
    await expect(page.getByRole('button', { name: language.signIn, exact: true })).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    const font = await page.locator('body').evaluate((node) => getComputedStyle(node).fontFamily);
    expect(font).toContain(language.code === 'ta' ? 'Noto Sans Tamil' : 'Noto Sans Devanagari');
    await page.reload();
    await expect(page.getByLabel(language.language)).toHaveValue(language.code);
    // Login through the API so this test is independent of translated field wording.
    const { E2E_PASSWORD } = await import('./fixtures/seed');
    const response = await page.request.post('/api/auth/login', {
      data: { email: ACCOUNTS.planning, password: E2E_PASSWORD },
    });
    expect(response.ok()).toBeTruthy();
    await page.goto('/my-tasks');
    await expect(page.getByRole('heading', { name: language.work, exact: true })).toBeVisible();
    await page.goto('/account');
    await expect(page.getByRole('heading', { name: /Planning/ })).toBeVisible();
    await expect(page.getByLabel(language.language).first()).toHaveValue(language.code);
    await expect(page.getByText(ACCOUNTS.planning, { exact: true }).first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({
      path: test.info().outputPath(`${language.code}-account.png`),
      fullPage: true,
    });
    await page.getByLabel(language.language).first().selectOption('en');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  });
  test(`${language.code}: narrow MD screens fit translated controls`, async ({ page }) => {
    await page.addInitScript(() => {
      const original = window.matchMedia.bind(window);
      window.matchMedia = (query) =>
        query === '(display-mode: standalone)'
          ? ({
              ...original(query),
              matches: true,
              addEventListener() {},
              removeEventListener() {},
            } as MediaQueryList)
          : original(query);
    });
    await signIn(page, ACCOUNTS.md);
    await page
      .context()
      .addCookies([{ name: 'jtas-language', value: language.code, url: 'http://localhost:3101' }]);
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 900 });
      for (const route of ['/dashboard', '/jobs', '/jobs/new', '/my-tasks']) {
        await page.goto(route);
        await page.evaluate(() => document.fonts.ready);
        await expect(page.locator('[data-phone-app="true"]')).toBeVisible();
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
          `${width}px ${route}`,
        ).toBe(true);
      }
    }
  });
  test(`${language.code}: installed phone keeps navigation and language options usable`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(() => {
      const original = window.matchMedia.bind(window);
      window.matchMedia = (query) =>
        query === '(display-mode: standalone)'
          ? ({
              ...original(query),
              matches: true,
              addEventListener() {},
              removeEventListener() {},
            } as MediaQueryList)
          : original(query);
    });
    await signIn(page, ACCOUNTS.planning);
    await page.goto('/account');
    const more = page.locator('.phone-app-tabs button');
    await more.click();
    await page.getByRole('dialog').getByLabel('Language').selectOption(language.code);
    await expect(page.locator('.phone-app-tabs')).toContainText(language.work);
    await expect(page.getByRole('dialog').getByLabel(language.language)).toHaveValue(language.code);
    await page.keyboard.press('Escape');
    await page.evaluate(() => document.fonts.ready);
    const heading = page.getByRole('heading', { name: /Planning/ });
    expect(await heading.evaluate((node) => getComputedStyle(node).letterSpacing)).toBe('normal');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({
      path: test.info().outputPath(`${language.code}-installed.png`),
      fullPage: true,
    });
  });
}

test('push requires an explicit enable click and offers a test and disable', async ({
  page,
  browserName,
}) => {
  test.skip(
    browserName === 'webkit',
    'Playwright WebKit cannot reliably emulate native push subscriptions.',
  );
  let enrolled = false;
  let tests = 0;
  const delays: number[] = [];
  await page.addInitScript(() => {
    Object.defineProperty(window, 'Notification', {
      value: {
        permission: 'default',
        requestPermission: async () => {
          (window as unknown as { pushRequests: number }).pushRequests++;
          return 'granted';
        },
      },
      configurable: true,
    });
    (window as unknown as { pushRequests: number }).pushRequests = 0;
    const subscription = {
      endpoint: 'https://fcm.googleapis.com/fcm/send/e2e',
      toJSON: () => ({
        endpoint: 'https://fcm.googleapis.com/fcm/send/e2e',
        keys: { p256dh: 'test', auth: 'test' },
      }),
      unsubscribe: async () => true,
    };
    PushManager.prototype.getSubscription = async () => null;
    PushManager.prototype.subscribe = async () => subscription as unknown as PushSubscription;
  });
  await page.route('**/api/push/subscriptions*', async (route) => {
    if (route.request().method() === 'GET')
      await route.fulfill({ json: { publicKey: 'B' + 'A'.repeat(86), endpointHashes: [] } });
    else {
      enrolled = route.request().method() !== 'DELETE';
      await route.fulfill({ status: 204 });
    }
  });
  await page.route('**/api/push/test', async (route) => {
    tests++;
    delays.push(route.request().postDataJSON().delaySeconds);
    await route.fulfill({ json: { sent: true } });
  });
  await signIn(page, ACCOUNTS.planning);
  await page.goto('/account');
  await expect(
    page.getByRole('button', { name: 'Enable notifications', exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => (window as unknown as { pushRequests: number }).pushRequests),
  ).toBe(0);
  await page.getByRole('button', { name: 'Enable notifications', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Send test notification' })).toBeVisible();
  expect(enrolled).toBe(true);
  await expect(page.getByRole('button', { name: 'Enable notifications', exact: true })).toHaveCount(
    0,
  );
  await expect(page.getByText('Jaraa alerts are on')).toBeVisible();
  await page.getByRole('button', { name: 'Send test notification' }).click();
  await expect(
    page.getByText('Test sent. Open your phone’s notification panel.', { exact: false }),
  ).toBeVisible();
  expect(tests).toBe(1);
  await page.getByRole('button', { name: 'Test with app closed' }).click();
  await expect.poll(() => tests).toBe(2);
  expect(delays).toEqual([0, 15]);
  await page.getByRole('button', { name: 'Disable notifications' }).click();
  await expect(page.getByRole('button', { name: 'Send test notification' })).toHaveCount(0);
  expect(enrolled).toBe(false);
});
