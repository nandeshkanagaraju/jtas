import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { FlatCompat } from '@eslint/eslintrc';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// eslint-config-next 15 ships eslintrc-style configs; FlatCompat adapts them.
const compat = new FlatCompat({ baseDirectory: __dirname });

const eslintConfig = [
  {
    ignores: [
      '.next/**',
      'out/**',
      'build/**',
      'coverage/**',
      'node_modules/**',
      'next-env.d.ts',
      'src/generated/**',
      'playwright-report/**',
      'test-results/**',
    ],
  },
  ...compat.extends('next/core-web-vitals', 'next/typescript', 'prettier'),
  {
    rules: {
      // Unused function arguments are often required to satisfy a signature;
      // an underscore prefix marks them as intentional.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      // Rule 3: authorisation is server-side. `any` erodes the type guarantees
      // the policy layer depends on, so it is an error rather than a warning.
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
  {
    // Tests routinely build partial fixtures and assert on thrown values.
    files: ['tests/**/*.ts', 'tests/**/*.tsx'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },
];

export default eslintConfig;
