import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * The whole test configuration.
 *
 * Two projects, because they have different needs:
 *
 *   unit        — pure, no database, no setup cost. Runs on any machine.
 *   integration — needs PostgreSQL. Its setup file redirects DATABASE_URL to a
 *                 per-worker schema inside the `_test` database, which is what
 *                 keeps the suite independent of ambient state. Loading that
 *                 setup for unit tests would make them fail wherever no
 *                 database is running, for no benefit.
 *
 * Declared here rather than in a `vitest.workspace.ts`: Vitest 5 removed
 * `defineWorkspace`, and projects now live inside `test`.
 */
export default defineConfig({
  /*
   * The base tsconfig sets "jsx": "preserve" for Next, which leaves esbuild on
   * the classic runtime — and the React Email templates then fail to render
   * with `React is not defined`. Declared here so the tests exercise the same
   * automatic runtime the app and the worker use.
   */
  esbuild: { jsx: 'automatic' },
  resolve: {
    // Mirrors the `@/*` -> `./src/*` alias in tsconfig.json. Declared inline
    // rather than via a plugin so the config stays loadable as CJS.
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    projects: [
      {
        extends: true,
        test: { name: 'unit', include: ['tests/unit/**/*.test.ts'] },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          include: ['tests/integration/**/*.test.ts'],
          setupFiles: ['tests/integration/setup.ts'],
        },
      },
    ],
    globals: true,
    environment: 'node',
    // Asserts IST behaviour from a UTC process, exactly as production runs
    // (TZ=UTC in .env.example). Pinned so a developer in another timezone
    // cannot get a green run that CI would fail.
    env: { TZ: 'UTC' },
    /*
     * Integration workers each get their own PostgreSQL schema, so running in
     * parallel would be safe — but each new worker pays a `prisma migrate
     * deploy` to create its schema. Serialising keeps that cost at one, and the
     * suite is fast enough that there is nothing to win.
     */
    fileParallelism: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/lib/domain/**', 'src/lib/notifications/**'],
      // SDD section 9: these two directories are where a bug costs real money.
      thresholds: { lines: 85, functions: 85, branches: 80, statements: 85 },
    },
  },
});
