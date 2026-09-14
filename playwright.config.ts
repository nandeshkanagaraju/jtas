import { execFileSync } from 'node:child_process';

import { config as loadEnv } from 'dotenv';
import { defineConfig, devices } from '@playwright/test';

loadEnv({ path: '.env', quiet: true });

/**
 * The suite truncates every table, so it runs against its own database —
 * `jtas_dev` becomes `jtas_e2e`. Derived here rather than in globalSetup
 * because Playwright reads `webServer.env` before any setup runs, and the app
 * under test has to be pointed at the same database the fixtures seed.
 */
const E2E_DATABASE_URL = (process.env.DATABASE_URL ?? '').replace(/(_dev|_test)(\?|$)/, '_e2e$2');

/*
 * Create and migrate it here, in config module scope.
 *
 * Playwright starts `webServer` before `globalSetup`, and the app's health
 * endpoint answers 503 without a database — so creating it in globalSetup means
 * the server never becomes ready and the run times out with a message about the
 * web server rather than about the database.
 */
if (E2E_DATABASE_URL && !process.env.PW_SKIP_DB_SETUP) {
  execFileSync('pnpm', ['exec', 'tsx', 'scripts/ensure-e2e-db.ts'], { stdio: 'inherit' });
}

/*
 * And point the runner itself at it.
 *
 * A spec that calls the notification engine directly — `dispatchDue`,
 * `escalateOverdue` — imports the application's global Prisma client, which
 * reads DATABASE_URL at import time. Without this the spec writes its fixtures
 * to jtas_e2e and then sweeps jtas_dev, which fails in the most confusing way
 * available: the row it just created is still PENDING, because a different
 * database was swept.
 *
 * Set before the config is exported, so every worker Playwright forks inherits
 * it.
 */
if (E2E_DATABASE_URL) process.env.DATABASE_URL = E2E_DATABASE_URL;

/*
 * Its own port.
 *
 * On 3000 Playwright reuses whatever is already listening — which, on a
 * developer's machine, is their own `pnpm dev` pointed at `jtas_dev`. The suite
 * then signs in against a database that has none of its fixtures, and every
 * spec fails at the login step with "waiting for navigation", which says
 * nothing whatever about the real cause.
 */
const E2E_PORT = 3101;
const E2E_BASE_URL = `http://localhost:${E2E_PORT}`;

/**
 * End-to-end configuration (SDD section 9). The suite drives a real build
 * against a seeded database, so it exercises middleware, route handlers and
 * the policy layer exactly as production does.
 */
export default defineConfig({
  testDir: './tests/e2e',
  // Rebuilds the `_e2e` database and seeds the known world before anything
  // runs, so the suite's assertions about counts and percentages are about the
  // code rather than about whatever the developer's database holds.
  globalSetup: './tests/e2e/global-setup.ts',
  /*
   * One worker, always.
   *
   * Every spec here shares one database and one seeded world, and the core
   * loop is a single story told in seven ordered steps. Running the two browser
   * projects concurrently interleaves two jobs into the same MD inbox and the
   * same My Tasks list, which fails as a strict-mode violation on a locator
   * that was perfectly specific — a confusing way to learn that the suite was
   * never parallel-safe. Isolating it properly would mean a database per
   * worker; for a suite this size that is not worth the machinery.
   */
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  timeout: 30_000,
  expect: { timeout: 5_000 },

  use: {
    baseURL: E2E_BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    // Assertions on rendered deadlines are written in IST, matching what a
    // user in Coimbatore actually sees.
    timezoneId: 'Asia/Kolkata',
    locale: 'en-IN',
  },

  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    // The shop floor uses phones; the member flow must pass on one.
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
    /*
     * Safari, because Chrome is forgiving in ways that hide real bugs.
     *
     * `upgrade-insecure-requests` in the CSP shipped for a day looking
     * perfectly fine: Chrome exempts localhost from it, Safari does not, and
     * the page rendered as bare HTML with no stylesheet and no JavaScript for
     * anybody on a Mac. Nothing in a Chromium-only suite could have caught it.
     */
    { name: 'safari', use: { ...devices['Desktop Safari'] } },
  ],

  webServer: {
    command: `pnpm build && pnpm start --port ${E2E_PORT}`,
    url: `${E2E_BASE_URL}/api/health`,
    env: {
      ...process.env,
      // The app must read the same database the fixtures seeded.
      DATABASE_URL: E2E_DATABASE_URL,
      /*
       * Playwright sets NODE_ENV=test for the runner, and `next build` inherits
       * it — which breaks the 404 prerender with "<Html> should not be imported
       * outside of pages/_document", an error that says nothing about the real
       * cause. The build under test must be a production build.
       */
      NODE_ENV: 'production',
      // Where the app thinks it is. The CSP is derived from this — a mismatched
      // value is how `upgrade-insecure-requests` ends up on a plain-http origin.
      APP_BASE_URL: E2E_BASE_URL,
    } as Record<string, string>,
    // Never reuse: the port is the suite's own, so anything already on it is
    // a leftover from a killed run rather than something to adopt.
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
