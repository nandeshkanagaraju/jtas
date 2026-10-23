import { expect, test, type Page } from '@playwright/test';
import { ACCOUNTS, E2E_PASSWORD, e2ePrisma } from './fixtures/seed';
import { signIn } from './fixtures/ui';
import { translate } from '../../src/lib/i18n/translate';
// Route interception must reach the browser network rather than a native SW.
test.use({ serviceWorkers: 'block' });
const db = e2ePrisma();
test.afterAll(async () => {
  await db.$disconnect();
});
async function scenario(label: string) {
  const users = await db.user.findMany({ where: { email: { in: Object.values(ACCOUNTS) } } });
  const md = users.find((user) => user.email === ACCOUNTS.md)!;
  const planning = users.find((user) => user.email === ACCOUNTS.planning)!;
  const purchase = users.find((user) => user.email === ACCOUNTS.purchase)!;
  const production = users.find((user) => user.email === ACCOUNTS.production)!;
  const deadline = new Date(Date.now() + 7 * 86400000);
  const job = await db.job.create({
    data: {
      jobCode: `LIVE-${label}-${Date.now()}`,
      title: 'Live progress sample',
      status: 'IN_PROGRESS',
      isDemo: true,
      createdById: md.id,
      overallDeadline: deadline,
    },
  });
  const first = await db.subtask.create({
    data: {
      jobId: job.id,
      title: 'Planning drawings',
      departmentId: planning.departmentId!,
      assigneeId: planning.id,
      status: 'COMPLETED',
      completedAt: new Date(),
      deadline,
    },
  });
  const second = await db.subtask.create({
    data: {
      jobId: job.id,
      title: 'Purchase materials',
      departmentId: purchase.departmentId!,
      assigneeId: purchase.id,
      status: 'IN_PROGRESS',
      dependsOnId: first.id,
      deadline,
    },
  });
  await db.subtask.create({
    data: {
      jobId: job.id,
      title: 'Production machining',
      departmentId: production.departmentId!,
      assigneeId: production.id,
      status: 'BLOCKED',
      dependsOnId: second.id,
      deadline,
    },
  });
  await db.auditLog.create({
    data: { action: 'JOB_PUBLISHED', entityType: 'JOB', entityId: job.id, actorId: md.id },
  });
  return { job, first, second };
}
async function installed(page: Page) {
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
}

test('shared messages and department handoffs arrive without reloading', async ({
  page,
  browser,
}, info) => {
  if (info.project.name === 'mobile') await installed(page);
  const { job, second } = await scenario(info.project.name);
  await signIn(page, ACCOUNTS.planning);
  await page.goto(`/updates?job=${job.id}`);
  await expect(page.getByRole('heading', { name: 'Live updates', exact: true })).toBeVisible();
  await expect(page.locator('.live-job-heading')).toContainText('Purchase');
  await expect(page.locator('.live-job-heading')).toContainText('33%');
  await expect(page.locator('.live-stage-node[data-current="true"]')).toHaveCount(1);
  await page.locator(`[data-stage-id="${second.id}"]`).click();
  const disclosure = page.locator('.live-composer summary');
  if (await disclosure.count()) await disclosure.click();
  const message = 'Material received. Production can prepare <b>tooling</b>.';
  await page.getByLabel('Job message', { exact: true }).fill(message);
  await page.getByRole('button', { name: 'Post message', exact: true }).click();
  await expect(
    page.locator('.live-message-body').getByText(message, { exact: true }),
  ).toBeVisible();
  await expect(page.locator('.live-message-body b')).toHaveCount(0);
  await page
    .getByLabel('Job message', { exact: true })
    .fill('Unsent update stays here while live events arrive.');
  const peer = await browser.newContext();
  const signedIn = await peer.request.post('http://localhost:3101/api/auth/login', {
    data: { email: ACCOUNTS.purchase, password: E2E_PASSWORD },
  });
  expect(signedIn.ok()).toBeTruthy();
  const posted = await peer.request.post(
    `http://localhost:3101/api/subtasks/${second.id}/comments`,
    { data: { body: 'Purchase has checked the accepted material quantity.' } },
  );
  expect(posted.ok()).toBeTruthy();
  await expect(
    page
      .locator('.live-message-body')
      .getByText('Purchase has checked the accepted material quantity.', { exact: true }),
  ).toBeVisible({ timeout: 12000 });
  await expect(page.getByLabel('Job message', { exact: true })).toHaveValue(
    'Unsent update stays here while live events arrive.',
  );
  const completed = await peer.request.post(
    `http://localhost:3101/api/subtasks/${second.id}/status`,
    { data: { action: 'COMPLETE', note: 'Materials received and accepted for production.' } },
  );
  expect(completed.ok(), await completed.text()).toBeTruthy();
  await expect(page.locator('.live-job-heading')).toContainText('Production', { timeout: 12000 });
  await expect(page.locator('.live-job-heading')).toContainText('67%');
  await page.route('**/api/live-jobs/**', (route) =>
    route.fulfill({
      status: 503,
      json: { error: { code: 'INTERNAL_ERROR', message: 'Connection interrupted' } },
    }),
  );
  await page.getByRole('button', { name: 'Refresh updates', exact: true }).click();
  await expect(page.getByText('Updates paused — retrying', { exact: true })).toBeVisible({
    timeout: 12000,
  });
  await expect(
    page.getByText('Connection interrupted. Showing the last received updates.', { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel('Job message', { exact: true })).toHaveValue(
    'Unsent update stays here while live events arrive.',
  );
  await page.unroute('**/api/live-jobs/**');
  await page.getByRole('button', { name: 'Refresh updates', exact: true }).click();
  await expect(page.getByText('Auto-updates every 5 seconds', { exact: true })).toBeVisible();
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({
    path: info.outputPath('live-messages.png'),
    fullPage: true,
    animations: 'disabled',
  });
  await peer.close();
});

test('Tamil and Hindi progress maps fit installed phones and wide web layouts', async ({
  page,
}, info) => {
  const { job } = await scenario('layout-' + info.project.name);
  await installed(page);
  await signIn(page, ACCOUNTS.md);
  for (const locale of ['ta', 'hi'] as const) {
    await page
      .context()
      .addCookies([{ name: 'jtas-language', value: locale, url: 'http://localhost:3101' }]);
    for (const width of [320, 390, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/updates?job=${job.id}`);
      await page.evaluate(() => document.fonts.ready);
      await expect(page.locator('.live-stage-node')).toHaveCount(3);
      await expect(page.locator('.live-map-edges > path')).toHaveCount(2);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        `${locale} map at ${width}px`,
      ).toBe(true);
      if (width < 1024)
        await page
          .getByRole('button', { name: translate('Updates and messages', locale), exact: true })
          .click();
      await expect(
        page.getByRole('heading', { name: translate('Updates and messages', locale), exact: true }),
      ).toBeVisible();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        `${locale} feed at ${width}px`,
      ).toBe(true);
      await page.screenshot({
        path: info.outputPath(`${locale}-${width}-updates.png`),
        fullPage: true,
        animations: 'disabled',
      });
    }
  }
});
