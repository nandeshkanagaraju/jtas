import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * Shared configuration. The suite is split into two projects by
 * `vitest.workspace.ts`; this file holds what both halves agree on.
 */
export default defineConfig({
  resolve: {
    // Mirrors the `@/*` -> `./src/*` alias in tsconfig.json. Declared inline
    // rather than via a plugin so the config stays loadable as CJS.
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
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
