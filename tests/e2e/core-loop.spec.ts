/**
 * The core loop, end to end (build spec M11.1).
 *
 * One job from creation to completion, through four people and a blocker:
 *
 *   a  the MD creates a job from the template and publishes it
 *   b  Planning sees it in My Tasks and completes it
 *   c  Purchase, which was BLOCKED, becomes actionable
 *   d  Purchase reports a BLOCKER problem
 *   e  the MD resolves it from the inbox by extending the deadline
 *   f  Purchase sees the new deadline and completes the task
 *   g  the dashboard's on-time percentage reflects what happened
 *
 * Written as one serial spec rather than seven independent ones because it is
 * one story: step (c) has no meaning without (b), and asserting the dependency
 * unblocked is the point.
 */
import { expect, test } from '@playwright/test';

import { formatIST } from '../../src/lib/utils/time';

import { ACCOUNTS, e2ePrisma } from './fixtures/seed';
import { pickIstDateTime, signIn } from './fixtures/ui';

test.describe.configure({ mode: 'serial' });

/** The job this spec creates, shared across the serial steps. */
let jobCode = '';
let jobId = '';

/** One subtask's status, by a fragment of its title. */
async function subtaskStatus(title: RegExp): Promise<string> {
  const prisma = e2ePrisma();
  try {
    const row = await prisma.subtask.findFirstOrThrow({
      where: { jobId, title: { contains: title.source.replace(/[^\w ]/g, '') } },
    });
    return row.status;
  } finally {
    await prisma.$disconnect();
  }
}

test('a — the MD creates a job from the template and publishes it', async ({ page }) => {
  await signIn(page, ACCOUNTS.md);
  await expect(page).toHaveURL(/\/dashboard/);

  await page.goto('/jobs/new');

  await page.getByLabel('Job title').fill('Spindle housing batch');
  await page.getByLabel(/part number/i).fill('SH-4410');

  // A month out, so nothing in this spec is accidentally overdue.
  await pickIstDateTime(page, 'Overall deadline', new Date(Date.now() + 30 * 24 * 3_600_000));

  await page.getByRole('button', { name: 'Save draft and continue' }).click();
  await page.waitForURL(/\/jobs\/[^/]+\/plan/, { timeout: 30_000 });

  jobId = page.url().split('/jobs/')[1].split('/')[0];

  const prisma = e2ePrisma();
  try {
    const job = await prisma.job.findUniqueOrThrow({ where: { id: jobId } });
    jobCode = job.jobCode;

    // FR-10: the code is allocated by the system, per year, in sequence.
    expect(jobCode).toMatch(/^JGE-\d{4}-\d{4}$/);
    expect(job.status).toBe('DRAFT');
  } finally {
    await prisma.$disconnect();
  }

  // Lay the chain out from the template, review it, then publish.
  await page.getByRole('button', { name: /^Apply/ }).click();
  await expect(page.locator('input[value*="Process plan"]')).toBeVisible({ timeout: 15_000 });

  await page.getByRole('button', { name: /^Review \(5\)$/ }).click();
  await page.getByRole('button', { name: 'Publish job' }).click();

  await page.waitForURL(new RegExp(`/jobs/${jobId}$`), { timeout: 30_000 });

  const prisma2 = e2ePrisma();
  try {
    const subtasks = await prisma2.subtask.findMany({
      where: { jobId },
      orderBy: { deadline: 'asc' },
      select: { title: true, status: true, dependsOnId: true },
    });

    expect(subtasks.length).toBe(5);

    // M4.3: the first step is actionable, everything downstream waits. This is
    // also the assertion that caught the template's first step being applied
    // with no dependents — `order` 0 is falsy.
    expect(subtasks[0].status).toBe('PENDING');
    expect(subtasks.slice(1).every((row) => row.status === 'BLOCKED')).toBe(true);
    expect(subtasks.slice(1).every((row) => row.dependsOnId !== null)).toBe(true);
  } finally {
    await prisma2.$disconnect();
  }
});

/**
 * The My Tasks card for one of this job's subtasks.
 *
 * Scoped by job code as well as title. The two browser projects run this spec
 * against the same seeded database, so by the second pass the member already
 * has a finished "Raise PO" card from the first — matching on the title alone
 * finds both.
 */
async function card(page: import('@playwright/test').Page, title: string | RegExp) {
  const found = page.locator('article').filter({ hasText: jobCode }).filter({ hasText: title });
  if ((await found.count()) > 0) return found;

  // Overdue and due today stay open. Everything else is folded, so a task a
  // month out is not in the document until its group is opened.
  for (const label of ['This week', 'Blocked', 'With the MD', 'Later', 'Done']) {
    const fold = page.getByRole('button', { name: new RegExp(`^${label} \\d`) });
    if ((await fold.count()) === 0) continue;
    const text = (await fold.innerText()).trim();
    if (text.endsWith(' 0')) continue;
    if ((await fold.getAttribute('aria-expanded')) !== 'true') await fold.click();
    if ((await found.count()) > 0) return found;
  }

  return found;
}

test('b — Planning sees it in My Tasks and completes it', async ({ page }) => {
  await signIn(page, ACCOUNTS.planning);
  await expect(page).toHaveURL(/\/my-tasks/);

  const planning = await card(page, /Process plan/);
  await expect(planning).toBeVisible({ timeout: 15_000 });
  await expect(planning).toContainText(jobCode);

  // Everything a member does happens on the card — FR-30 is explicit that the
  // shop floor should not have to navigate to finish a task.
  await planning.getByRole('button', { name: 'Start work', exact: true }).click();
  await planning.getByRole('button', { name: 'Mark completed', exact: true }).click();

  await expect.poll(() => subtaskStatus(/Process plan/), { timeout: 20_000 }).toBe('COMPLETED');
});

test('c — Purchase, previously BLOCKED, becomes actionable', async ({ page }) => {
  // Completing the dependency is what unblocks it — the cascade in M4.4, not
  // anything this spec did by hand.
  expect(await subtaskStatus(/Raise PO/)).toBe('PENDING');

  await signIn(page, ACCOUNTS.purchase);

  const purchase = await card(page, /Raise PO/);
  await expect(purchase).toBeVisible({ timeout: 15_000 });

  // Actionable: a blocked card offers no buttons at all, only the line naming
  // what it waits for.
  await expect(purchase.getByRole('button', { name: 'Start work', exact: true })).toBeEnabled();
  await expect(purchase).not.toContainText('Waiting on');
});

test('d — Purchase reports a BLOCKER problem', async ({ page }) => {
  await signIn(page, ACCOUNTS.purchase);

  const purchase = await card(page, /Raise PO/);
  await purchase.getByRole('button', { name: 'Report problem', exact: true }).click();

  // Severity drives the MD inbox's order (M6).
  await purchase.getByRole('button', { name: 'Blocker' }).click();
  await purchase
    .getByRole('textbox')
    .fill('Material short by twelve bars; the supplier has not confirmed a date.');
  // The opener and the submit share the words "Report problem". The submit is
  // the sibling of Cancel, so the locator cannot match both.
  await purchase
    .getByRole('button', { name: 'Cancel', exact: true })
    .locator('..')
    .getByRole('button', { name: 'Report problem', exact: true })
    .click();

  const prisma = e2ePrisma();
  try {
    await expect
      .poll(
        async () => {
          const problem = await prisma.problem.findFirst({ where: { subtask: { jobId } } });
          return problem ? `${problem.severity}/${problem.status}` : null;
        },
        { timeout: 20_000 },
      )
      .toBe('BLOCKER/OPEN');

    // The subtask parks rather than staying due, so the sweeper stops chasing
    // somebody for work they have already flagged (improvement I-05).
    expect(await subtaskStatus(/Raise PO/)).toBe('PROBLEM');
  } finally {
    await prisma.$disconnect();
  }
});

test('e — the MD resolves it from the inbox by extending the deadline', async ({ page }) => {
  await signIn(page, ACCOUNTS.md);
  await page.goto('/problems');

  await page.getByRole('row').filter({ hasText: jobCode }).click();

  const drawer = page.getByRole('dialog');
  await expect(drawer).toBeVisible({ timeout: 15_000 });

  await drawer.getByRole('button', { name: 'Mark as seen' }).click();

  // Acknowledging refetches the list behind the drawer, which re-renders it.
  // Waiting for the button to go — it only exists while the problem is OPEN —
  // is the signal that the round trip has landed.
  await expect(drawer.getByRole('button', { name: 'Mark as seen' })).toHaveCount(0, {
    timeout: 15_000,
  });

  await drawer.getByRole('button', { name: 'Resolve it' }).click();

  // EXTEND is the resolution that moves the deadline, and the only one that
  // has to write a DeadlineChange row (M6).
  await drawer.getByRole('radio', { name: 'Give more time' }).click();
  await pickIstDateTime(page, /^New deadline/, new Date(Date.now() + 20 * 24 * 3_600_000));

  await drawer
    .getByRole('textbox')
    .last()
    .fill('Supplier confirmed a revised date; four days granted.');
  await drawer.getByRole('button', { name: 'Resolve', exact: true }).click();

  const prisma = e2ePrisma();
  try {
    await expect
      .poll(
        async () => {
          const problem = await prisma.problem.findFirst({ where: { subtask: { jobId } } });
          return problem?.status;
        },
        { timeout: 20_000 },
      )
      .toBe('RESOLVED');

    // The extension is recorded, not merely applied — FR-27 wants the original
    // deadline still answerable a year later.
    const change = await prisma.deadlineChange.findFirst({ where: { subtask: { jobId } } });
    expect(change).not.toBeNull();
    expect(change!.oldDeadline).not.toEqual(change!.newDeadline);
  } finally {
    await prisma.$disconnect();
  }
});

test('f — Purchase sees the new deadline and completes the task', async ({ page }) => {
  const prisma = e2ePrisma();
  let deadline: Date;

  try {
    const subtask = await prisma.subtask.findFirstOrThrow({
      where: { jobId, title: { contains: 'Raise PO' } },
    });
    deadline = subtask.deadline!;

    // Back in the member's hands, and already running: FR-43 returns a
    // resolved subtask to IN_PROGRESS rather than making somebody press Start
    // again for work they never stopped doing.
    expect(subtask.status).toBe('IN_PROGRESS');
  } finally {
    await prisma.$disconnect();
  }

  await signIn(page, ACCOUNTS.purchase);

  const purchase = await card(page, /Raise PO/);
  await expect(purchase).toBeVisible({ timeout: 15_000 });

  // The card shows the deadline the MD granted, rendered in IST — the same
  // instant a UTC-rendering bug would show a day out.
  await expect(purchase).toContainText(formatIST(deadline));

  // No Start: it is already running, so the card offers only the finish.
  await expect(purchase.getByRole('button', { name: 'Start work', exact: true })).toHaveCount(0);
  await purchase.getByRole('button', { name: 'Mark completed', exact: true }).click();

  await expect.poll(() => subtaskStatus(/Raise PO/), { timeout: 20_000 }).toBe('COMPLETED');
});

test('g — the dashboard reflects the on-time percentage', async ({ page }) => {
  const prisma = e2ePrisma();
  let expected: string;

  try {
    // Every completed subtask, not just this job's: the dashboard counts the
    // whole shop, and a second pass of this spec adds to it.
    const completed = await prisma.subtask.findMany({
      where: { status: 'COMPLETED' },
      select: { deadline: true, completedAt: true },
    });

    expect(completed.length).toBeGreaterThanOrEqual(2);

    // The same rule lib/domain/metrics applies: completedAt <= the deadline in
    // force. Both were finished well inside theirs, so this is 100 — the point
    // being that the screen agrees with the definition, not the number.
    const onTime = completed.filter((row) => row.completedAt! <= row.deadline!).length;
    expected =
      `${Math.round((onTime / completed.length) * 1000) / 10}% of ${completed.length} ` +
      'completed subtasks were on time';
  } finally {
    await prisma.$disconnect();
  }

  await signIn(page, ACCOUNTS.md);
  await page.goto('/dashboard');

  await expect(page.getByRole('heading', { name: 'Problems' })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(expected)).toBeVisible({ timeout: 20_000 });
});
