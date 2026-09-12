import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end configuration (SDD section 9). The suite drives a real build
 * against a seeded database, so it exercises middleware, route handlers and
 * the policy layer exactly as production does.
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  timeout: 30_000,
  expect: { timeout: 5_000 },

  use: {
    baseURL: process.env.APP_BASE_URL ?? 'http://localhost:3000',
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
  ],

  webServer: {
    command: 'pnpm build && pnpm start',
    url: 'http://localhost:3000/api/health',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
