import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { PostgresRateLimiter } from '@/lib/auth/rate-limit';
import { withSchedulerLease } from '@/lib/notifications/scheduler-lease';

import { testDb } from './helpers/db';

beforeEach(async () => {
  await testDb.rateLimitBucket.deleteMany();
  await testDb.schedulerLease.deleteMany();
});

afterAll(async () => {
  await testDb.rateLimitBucket.deleteMany();
  await testDb.schedulerLease.deleteMany();
  await testDb.$disconnect();
});

describe('shared PostgreSQL rate limits', () => {
  it('allows exactly ten concurrent hits across separate instances', async () => {
    const instances = [new PostgresRateLimiter(), new PostgresRateLimiter()];
    const hits = await Promise.all(
      Array.from({ length: 25 }, (_, i) => instances[i % 2].hit('auth:shared', 10, 60)),
    );
    expect(hits.filter((hit) => hit.allowed)).toHaveLength(10);
    expect(hits.every((hit) => hit.retryAfterSeconds > 0)).toBe(true);
    expect(
      await testDb.rateLimitBucket.findUnique({ where: { key: 'auth:shared' } }),
    ).toMatchObject({
      count: 25,
    });
  });

  it('resets expired buckets and clears successful-login buckets', async () => {
    const limiter = new PostgresRateLimiter();
    await limiter.hit('auth:reset', 1, 60);
    expect((await limiter.hit('auth:reset', 1, 60)).allowed).toBe(false);
    await testDb.rateLimitBucket.update({
      where: { key: 'auth:reset' },
      data: { expiresAt: new Date(0) },
    });
    expect((await limiter.hit('auth:reset', 1, 60)).allowed).toBe(true);
    await limiter.reset('auth:reset');
    expect((await limiter.hit('auth:reset', 1, 60)).allowed).toBe(true);
  });
});

describe('scheduled reminder exclusivity', () => {
  it('skips overlapping jobs and permits the next job after release', async () => {
    let release!: () => void;
    let acquired!: () => void;
    const entered = new Promise<void>((resolve) => {
      acquired = resolve;
    });
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = withSchedulerLease(async () => {
      acquired();
      await blocked;
      return 'first';
    });
    await entered;
    try {
      expect(await withSchedulerLease(async () => 'overlap')).toBeNull();
    } finally {
      release();
    }
    expect(await first).toBe('first');
    expect(await withSchedulerLease(async () => 'next')).toBe('next');
  });

  it('recovers expired leases and releases a lease on job failure', async () => {
    await testDb.schedulerLease.create({
      data: { key: 'notifications', owner: 'crashed-job', expiresAt: new Date(0) },
    });
    await expect(
      withSchedulerLease(async () => {
        throw new Error('provider outage');
      }),
    ).rejects.toThrow('provider outage');
    expect(await withSchedulerLease(async () => 'recovered')).toBe('recovered');
  });
});
