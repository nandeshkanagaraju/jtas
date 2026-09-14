/**
 * `pnpm docs:shots` — the screenshots in docs/MEMBER_GUIDE.md and
 * docs/ADMIN_GUIDE.md, captured from the showcase dataset.
 *
 * Hand-taken screenshots go stale silently: the guide keeps showing a button
 * that was renamed two releases ago, and nobody notices until a new starter
 * cannot find it. Regenerating them is one command.
 *
 * Runs against its own database and its own server, both created here and
 * thrown away afterwards. The developer's `jtas_dev` usually holds the
 * five-hundred-job performance set, and a guide screenshot showing 1,202
 * overdue subtasks teaches a new starter nothing except that the system is on
 * fire. It also means this touches nothing anybody is using.
 *
 * Needs a built app (`pnpm build`) and Postgres up. Local-only, on the same
 * rule as `pnpm db:reset`.
 */
import { execFileSync, spawn } from 'node:child_process';

import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { chromium, type Page } from '@playwright/test';
import { Client } from 'pg';

import { SEED_DEPARTMENTS } from '../prisma/seed-data/departments';
import { SEED_SETTINGS } from '../prisma/seed-data/settings';
import { generateTempPassword } from '../src/lib/auth/temp-password';

import {
  assertLocalDisposableDatabase,
  UnsafeDatabaseError,
  type ParsedDatabaseUrl,
} from './lib/database-url';

/** Its own port, so a dev server on 3000 keeps working while this runs. */
const PORT = 3210;
const APP_URL = `http://localhost:${PORT}`;
const OUT = 'docs/images';

interface Shot {
  name: string;
  as: string;
  path: string;
  /** Anything that must be on screen before the shutter goes. */
  waitFor?: string;
  prepare?: (page: Page) => Promise<void>;
}

const SHOTS: Shot[] = [
  {
    name: 'member-my-tasks',
    as: 'production@showcase.invalid',
    path: '/my-tasks',
    waitFor: 'Machining and first-piece clearance',
  },
  {
    name: 'member-report-problem',
    // Store, not Purchase: Purchase's one open task already has a problem on
    // it, so the card shows the "reported" line instead of the buttons.
    as: 'store@showcase.invalid',
    path: '/my-tasks',
    waitFor: 'Receive, inspect and issue material',
    prepare: async (page) => {
      await page.getByRole('button', { name: 'Problem' }).first().click();
      await page.getByRole('button', { name: 'Blocker' }).first().click();
    },
  },
  {
    name: 'md-dashboard',
    as: 'md@showcase.invalid',
    path: '/dashboard',
    waitFor: 'Dashboard',
  },
  {
    name: 'md-problems',
    as: 'md@showcase.invalid',
    path: '/problems',
    waitFor: 'Material short',
  },
  {
    name: 'md-job-detail',
    as: 'md@showcase.invalid',
    path: '/jobs',
    waitFor: 'JGE-SHOW-',
  },
];

/** `jtas_dev` -> `jtas_docs_test`, which the disposable-database guard accepts. */
function shotsDatabaseUrl(configured: string): string {
  return configured.replace(/(_dev|_test)(\?|$)/, '_docs_test$2');
}

/** Creates the database if it is not there, then brings it up to the schema. */
async function ensureDatabase(url: string): Promise<void> {
  const name = new URL(url).pathname.replace(/^\//, '').split('?')[0];

  const admin = new URL(url);
  admin.pathname = '/postgres';

  const client = new Client({ connectionString: admin.toString() });
  await client.connect();

  try {
    const exists = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
    if (exists.rowCount === 0) await client.query(`CREATE DATABASE "${name}"`);
  } finally {
    await client.end();
  }

  execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
  });
}

/**
 * Departments and settings — the two things the showcase seed needs under it.
 *
 * Not the ordinary `pnpm seed`: that creates the real roster against the real
 * addresses, which has no business in a throwaway screenshot database.
 */
async function seedFoundations(prisma: PrismaClient): Promise<void> {
  for (const department of SEED_DEPARTMENTS) {
    await prisma.department.upsert({
      where: { code: department.code },
      create: { ...department, isActive: true },
      update: {},
    });
  }

  for (const [key, value] of Object.entries(SEED_SETTINGS)) {
    await prisma.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
  }
}

/** Starts the built app against the shots database and waits for it to answer. */
async function startServer(databaseUrl: string): Promise<() => void> {
  const server = spawn('pnpm', ['start', '--port', String(PORT)], {
    env: { ...process.env, DATABASE_URL: databaseUrl, PORT: String(PORT), NEXT_OUTPUT: '' },
    stdio: 'ignore',
  });

  const stop = () => server.kill('SIGTERM');

  for (let i = 0; i < 60; i++) {
    try {
      const response = await fetch(`${APP_URL}/api/health`);
      if (response.status === 200 || response.status === 503) return stop;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }

  stop();
  throw new Error(`The app did not start on ${APP_URL}. Run \`pnpm build\` first.`);
}

async function main() {
  const configured = process.env.DATABASE_URL;
  if (!configured) {
    console.error('DATABASE_URL is not set.');
    process.exit(1);
  }

  const databaseUrl = shotsDatabaseUrl(configured);

  let parsed: ParsedDatabaseUrl;
  try {
    parsed = assertLocalDisposableDatabase(databaseUrl);
  } catch (error) {
    console.error(error instanceof UnsafeDatabaseError ? `\n${error.message}\n` : String(error));
    process.exit(1);
  }

  console.log(`\nTarget: ${parsed.host}:${parsed.port}/${parsed.database}`);
  await ensureDatabase(databaseUrl);

  const prisma = new PrismaClient({ datasourceUrl: databaseUrl });
  const password = generateTempPassword();
  const passwordHash = await bcrypt.hash(password, 10);

  let stopServer: (() => void) | null = null;

  try {
    await seedFoundations(prisma);

    execFileSync('pnpm', ['exec', 'tsx', 'scripts/seed-showcase.ts'], {
      env: { ...process.env, DATABASE_URL: databaseUrl, SEED_CREDENTIALS_FILE: 'none' },
      stdio: 'pipe',
    });

    // A password this script knows, on accounts nobody else will ever use.
    await prisma.user.updateMany({
      where: { email: { endsWith: '@showcase.invalid' } },
      data: { passwordHash, mustChangePassword: false },
    });

    console.log(`Starting the app on ${APP_URL}…\n`);
    stopServer = await startServer(databaseUrl);

    const browser = await chromium.launch();

    try {
      for (const shot of SHOTS) {
        const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
        const page = await context.newPage();

        await page.goto(`${APP_URL}/login`);
        await page.getByLabel(/email/i).fill(shot.as);
        await page.getByLabel(/password/i).fill(password);
        await page.getByRole('button', { name: /sign in/i }).click();
        await page.waitForURL((next) => !next.pathname.includes('/login'), { timeout: 30_000 });

        await page.goto(`${APP_URL}${shot.path}`);
        if (shot.waitFor) {
          await page.getByText(shot.waitFor).first().waitFor({ timeout: 20_000 });
        }
        await shot.prepare?.(page);

        // Charts animate in, and a screenshot taken mid-animation shows half a
        // bar — which reads as a rendering bug in the guide.
        await page.waitForTimeout(1_200);

        await page.screenshot({ path: `${OUT}/${shot.name}.png` });
        console.log(`  ${OUT}/${shot.name}.png`);

        await context.close();
      }
    } finally {
      await browser.close();
    }

    console.log('\nDone.\n');
  } finally {
    stopServer?.();
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
