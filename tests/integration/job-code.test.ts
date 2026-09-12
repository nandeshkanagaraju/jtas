import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { parseJobCode } from '@/lib/domain/job-code';
import { allocateJobCode } from '@/lib/services/jobs/job-code';

import { resetAuthTables, testDb } from './helpers/db';

/**
 * SDD section 4.1 requires that concurrent creates cannot collide on a job
 * code. This is the test the build spec asks for by name, and it is the reason
 * allocation is a single locking statement rather than a read followed by a
 * write.
 */
beforeEach(async () => {
  await resetAuthTables();
  await testDb.jobCodeCounter.deleteMany();
});

afterAll(async () => {
  await testDb.jobCodeCounter.deleteMany();
  await testDb.$disconnect();
});

describe('allocateJobCode', () => {
  it('starts a year at 0001 and increments', async () => {
    const instant = new Date('2026-06-15T12:00:00Z');

    const first = await testDb.$transaction((tx) => allocateJobCode(tx, instant));
    const second = await testDb.$transaction((tx) => allocateJobCode(tx, instant));

    expect(first).toBe('JGE-2026-0001');
    expect(second).toBe('JGE-2026-0002');
  });

  it('keeps a separate sequence per calendar year', async () => {
    const y2026 = await testDb.$transaction((tx) =>
      allocateJobCode(tx, new Date('2026-06-15T12:00:00Z')),
    );
    const y2027 = await testDb.$transaction((tx) =>
      allocateJobCode(tx, new Date('2027-06-15T12:00:00Z')),
    );
    const y2026Again = await testDb.$transaction((tx) =>
      allocateJobCode(tx, new Date('2026-08-01T12:00:00Z')),
    );

    expect(y2026).toBe('JGE-2026-0001');
    expect(y2027).toBe('JGE-2027-0001');
    expect(y2026Again).toBe('JGE-2026-0002');
  });

  it('uses the IST year across the New Year boundary', async () => {
    // 20:30 UTC on 31 Dec 2026 is already 02:00 IST on 1 Jan 2027.
    const code = await testDb.$transaction((tx) =>
      allocateJobCode(tx, new Date('2026-12-31T20:30:00Z')),
    );
    expect(code).toBe('JGE-2027-0001');
  });

  it('produces 20 distinct codes under 20 concurrent transactions', async () => {
    const instant = new Date('2026-06-15T12:00:00Z');

    // All twenty start before any of them finishes, which is exactly the race
    // the row lock has to survive.
    const codes = await Promise.all(
      Array.from({ length: 20 }, () => testDb.$transaction((tx) => allocateJobCode(tx, instant))),
    );

    expect(new Set(codes).size).toBe(20);

    // Gapless 1..20, in some order.
    const sequences = codes.map((code) => parseJobCode(code)!.sequence).sort((a, b) => a - b);
    expect(sequences).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
  });

  it('rolls the number back when the surrounding transaction fails', async () => {
    const instant = new Date('2026-06-15T12:00:00Z');

    await testDb.$transaction((tx) => allocateJobCode(tx, instant));

    // A create that fails after allocating must not burn the number.
    await expect(
      testDb.$transaction(async (tx) => {
        await allocateJobCode(tx, instant);
        throw new Error('job insert failed');
      }),
    ).rejects.toThrow('job insert failed');

    const next = await testDb.$transaction((tx) => allocateJobCode(tx, instant));
    expect(next).toBe('JGE-2026-0002');
  });
});
