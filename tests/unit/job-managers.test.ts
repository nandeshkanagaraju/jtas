import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { isJobManager } from '@/lib/auth/job-managers';
import { resetEnvCache } from '@/lib/utils/env';

describe('JOB_MANAGER_EMAILS', () => {
  beforeEach(() => {
    vi.stubEnv('DATABASE_URL', 'postgresql://unused:unused@localhost:5432/unused');
    vi.stubEnv('JWT_SECRET', 'unit-test-placeholder-secret-at-least-32-chars');
    vi.stubEnv('REFRESH_SECRET', 'unit-test-placeholder-refresh-at-least-32-chars');
    vi.stubEnv('JOB_MANAGER_EMAILS', ' Marketing@JaraaGlobal.in ');
    resetEnvCache();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    resetEnvCache();
  });

  it('matches listed addresses regardless of case and spacing', () => {
    expect(isJobManager({ email: 'marketing@jaraaglobal.in' })).toBe(true);
    expect(isJobManager({ email: 'planning@jaraaglobal.in' })).toBe(false);
  });

  it('is nobody when the setting is empty', () => {
    vi.stubEnv('JOB_MANAGER_EMAILS', '');
    resetEnvCache();
    expect(isJobManager({ email: 'marketing@jaraaglobal.in' })).toBe(false);
  });
});
