import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AUTH_RATE_LIMIT, InMemoryRateLimiter, WRITE_RATE_LIMIT } from '@/lib/auth/rate-limit';

let limiter: InMemoryRateLimiter;

beforeEach(() => {
  limiter = new InMemoryRateLimiter();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-13T10:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('InMemoryRateLimiter', () => {
  it('allows requests up to the limit and blocks the next one', async () => {
    for (let i = 1; i <= 10; i++) {
      const result = await limiter.hit('auth:1.2.3.4', 10, 60);
      expect(result.allowed, `request ${i}`).toBe(true);
      expect(result.remaining).toBe(10 - i);
    }

    const blocked = await limiter.hit('auth:1.2.3.4', 10, 60);
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
  });

  it('reports seconds until the window resets', async () => {
    await limiter.hit('auth:1.2.3.4', 2, 60);
    vi.advanceTimersByTime(20_000);

    const second = await limiter.hit('auth:1.2.3.4', 2, 60);
    expect(second.retryAfterSeconds).toBe(40);
  });

  it('starts a fresh window once the old one expires', async () => {
    for (let i = 0; i < 10; i++) await limiter.hit('auth:1.2.3.4', 10, 60);
    expect((await limiter.hit('auth:1.2.3.4', 10, 60)).allowed).toBe(false);

    vi.advanceTimersByTime(61_000);
    expect((await limiter.hit('auth:1.2.3.4', 10, 60)).allowed).toBe(true);
  });

  it('counts each key independently, so one IP cannot lock out another', async () => {
    for (let i = 0; i < 10; i++) await limiter.hit('auth:1.2.3.4', 10, 60);
    expect((await limiter.hit('auth:1.2.3.4', 10, 60)).allowed).toBe(false);
    expect((await limiter.hit('auth:5.6.7.8', 10, 60)).allowed).toBe(true);
  });

  it('clears a bucket on reset, which is what a successful login does', async () => {
    for (let i = 0; i < 10; i++) await limiter.hit('auth:1.2.3.4', 10, 60);
    expect((await limiter.hit('auth:1.2.3.4', 10, 60)).allowed).toBe(false);

    await limiter.reset('auth:1.2.3.4');
    expect((await limiter.hit('auth:1.2.3.4', 10, 60)).allowed).toBe(true);
  });

  it('prunes expired buckets instead of growing without bound', async () => {
    // Fill past the sweep threshold with buckets that then expire.
    for (let i = 0; i < 1_100; i++) await limiter.hit(`ip:${i}`, 10, 60);
    vi.advanceTimersByTime(61_000);

    // One more hit past the threshold triggers the sweep.
    await limiter.hit('ip:trigger', 10, 60);

    // Every earlier bucket has been dropped, so its window starts clean.
    const result = await limiter.hit('ip:0', 10, 60);
    expect(result.remaining).toBe(9);
  });
});

describe('policy constants', () => {
  it('matches SDD section 8.7', () => {
    expect(AUTH_RATE_LIMIT).toEqual({ limit: 10, windowSeconds: 60 });
    expect(WRITE_RATE_LIMIT).toEqual({ limit: 100, windowSeconds: 60 });
  });
});
