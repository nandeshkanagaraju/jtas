import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // Mirrors the `@/*` -> `./src/*` alias in tsconfig.json. Declared inline
    // rather than via vite-tsconfig-paths so the config stays loadable as CJS.
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    globals: true,
    environment: 'node',
    // The suite asserts IST behaviour from a UTC process, exactly as production
    // runs (TZ=UTC in .env.example). Pinning it here means a developer in a
    // different local timezone cannot get a green run that CI would fail.
    env: { TZ: 'UTC' },
    include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts'],
    setupFiles: ['tests/integration/setup.ts'],
    // Integration tests share one database; running files in parallel would
    // let one suite truncate a table another is mid-way through using.
    fileParallelism: false,
    exclude: ['tests/e2e/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/lib/domain/**', 'src/lib/notifications/**'],
      // SDD section 9: these two directories are where a bug costs real money.
      thresholds: { lines: 85, functions: 85, branches: 80, statements: 85 },
    },
  },
});
