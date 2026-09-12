import { defineWorkspace } from 'vitest/config';

/**
 * Two projects, because they have different needs:
 *
 *   unit        — pure, no database, no setup cost. Runs on any machine.
 *   integration — needs PostgreSQL. Its setup file redirects DATABASE_URL to a
 *                 per-worker schema inside the `_test` database, which is what
 *                 keeps the suite independent of ambient state. Loading that
 *                 setup for unit tests would make them fail wherever no
 *                 database is running, for no benefit.
 */
export default defineWorkspace([
  {
    extends: './vitest.config.ts',
    test: {
      name: 'unit',
      include: ['tests/unit/**/*.test.ts'],
    },
  },
  {
    extends: './vitest.config.ts',
    test: {
      name: 'integration',
      include: ['tests/integration/**/*.test.ts'],
      setupFiles: ['tests/integration/setup.ts'],
    },
  },
]);
