import { expect, test } from '@playwright/test';
import { ACCOUNTS, e2ePrisma } from './fixtures/seed';
import { signIn } from './fixtures/ui';

const db = e2ePrisma();
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });
test.afterAll(async () => {
  await db.$disconnect();
});

test('phone task titles and explicit actions open the task; navigation stays accessible', async ({
  page,
}) => {
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
  const member = await db.user.findUniqueOrThrow({ where: { email: ACCOUNTS.planning } });
  const md = await db.user.findUniqueOrThrow({ where: { email: ACCOUNTS.md } });
  const job = await db.job.create({
    data: {
      jobCode: `TAP-${Date.now()}`,
      title: 'Mobile touch regression',
      status: 'IN_PROGRESS',
      isDemo: true,
      createdById: md.id,
      overallDeadline: new Date(Date.now() + 86400000),
    },
  });
  const task = await db.subtask.create({
    data: {
      jobId: job.id,
      title: 'Tap this task title',
      departmentId: member.departmentId!,
      assigneeId: member.id,
      status: 'PENDING',
      commitmentDueAt: new Date(Date.now() + 3600000),
    },
  });
  await signIn(page, ACCOUNTS.planning);
  await page.goto('/my-tasks');
  const card = page.locator('.task-work-card').filter({ hasText: task.title });
  await expect(page.locator('.task-open-area')).toHaveCount(1);
  await expect(card).toHaveCount(1);
  await expect(card).toBeVisible();
  await expect(card.getByRole('button', { name: 'Start work' })).toHaveCount(0);
  await card.getByText(task.title, { exact: true }).tap();
  await expect(page).toHaveURL(new RegExp(`/tasks/${task.id}$`));
  await expect(page.getByRole('heading', { name: task.title, exact: true })).toBeVisible();
  await page.locator('.phone-app-header').getByRole('link', { name: 'Back to list' }).tap();
  await expect(card).toHaveCount(1);
  await expect(card).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('mobile-my-work.png'), fullPage: true });
  await card.getByRole('link', { name: 'Set deadline', exact: true }).tap();
  await expect(page).toHaveURL(new RegExp(`/tasks/${task.id}$`));
  await page.locator('.phone-app-tabs').getByRole('link', { name: 'Live updates' }).tap();
  await expect(page).toHaveURL(/\/updates$/);
  await page.locator('.phone-app-tabs').getByRole('button', { name: 'More' }).tap();
  const menu = page.getByRole('dialog');
  await expect(menu.getByRole('link', { name: 'Your account', exact: true })).toBeVisible();
  await menu.getByRole('link', { name: 'Push notifications', exact: true }).tap();
  await expect(page).toHaveURL(/\/account#push$/);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({
    path: test.info().outputPath('mobile-push-settings.png'),
    fullPage: true,
  });
});
