import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { canChangeOwnPassword, canSetAnyPassword, isDeveloper } from '@/lib/auth/developer';
import { resetEnvCache } from '@/lib/utils/env';

describe('password access', () => {
  beforeEach(() => {
    // env() validates the whole schema; placeholders satisfy the required keys.
    vi.stubEnv('DATABASE_URL', 'postgresql://unused:unused@localhost:5432/unused');
    vi.stubEnv('JWT_SECRET', 'unit-test-placeholder-secret-at-least-32-chars');
    vi.stubEnv('REFRESH_SECRET', 'unit-test-placeholder-refresh-at-least-32-chars');
    vi.stubEnv('DEVELOPER_EMAILS', ' Dev@Example.com , second@example.com ');
    resetEnvCache();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    resetEnvCache();
  });

  it('recognises listed developers regardless of case and spacing', () => {
    expect(isDeveloper({ email: 'dev@example.com' })).toBe(true);
    expect(isDeveloper({ email: 'SECOND@example.com' })).toBe(true);
    expect(isDeveloper({ email: 'someone@example.com' })).toBe(false);
  });

  it('lets only the MD and developers change their own password', () => {
    expect(canChangeOwnPassword({ email: 'md@example.com', role: 'MD' })).toBe(true);
    expect(canChangeOwnPassword({ email: 'dev@example.com', role: 'MEMBER' })).toBe(true);
    for (const role of ['DEPUTY_MD', 'ADMIN', 'MEMBER']) {
      expect(canChangeOwnPassword({ email: 'someone@example.com', role })).toBe(false);
    }
  });

  it('lets only developers set another account’s password', () => {
    expect(canSetAnyPassword({ email: 'dev@example.com' })).toBe(true);
    expect(canSetAnyPassword({ email: 'md@example.com' })).toBe(false);
  });

  it('treats an unset allowlist as no developers', () => {
    vi.stubEnv('DEVELOPER_EMAILS', '');
    resetEnvCache();
    expect(isDeveloper({ email: 'dev@example.com' })).toBe(false);
    expect(canChangeOwnPassword({ email: 'dev@example.com', role: 'ADMIN' })).toBe(false);
  });
});
