import { describe, expect, it } from 'vitest';

import {
  assignedKey,
  deadlineChangedKey,
  digestKey,
  jobCompletedKey,
  overdueMdKey,
  overdueMemberKey,
  problemRaisedKey,
  problemResolvedKey,
  readyToStartKey,
  reminderKey,
} from '@/lib/notifications/dedupe';
import { fromISTInput, istDateKey } from '@/lib/utils/time';

const SUBTASK = 'sub-1';
const USER = 'user-1';

describe('the SDD 5.1 key formats', () => {
  it('matches the documented shapes exactly', () => {
    expect(assignedKey(SUBTASK, USER)).toBe('subtask:sub-1:ASSIGNED:user-1');
    expect(reminderKey(SUBTASK, new Date(1_700_000_000_000))).toBe(
      'subtask:sub-1:REMINDER:1700000000000',
    );
    expect(overdueMemberKey(SUBTASK, 2)).toBe('subtask:sub-1:OVERDUE_MEMBER:2');
    expect(overdueMdKey(SUBTASK, 2, USER)).toBe('subtask:sub-1:OVERDUE_MD:2:user-1');
    expect(problemRaisedKey('prob-1', USER)).toBe('problem:prob-1:RAISED:user-1');
    expect(digestKey(USER, '2026-09-13')).toBe('digest:user-1:2026-09-13');
    expect(readyToStartKey(SUBTASK, 'sub-0', USER)).toBe('subtask:sub-1:READY:sub-0:user-1');
  });
});

describe('reminderKey', () => {
  it('changes when the deadline changes — the point of the whole design', () => {
    // SDD 5.1: including the deadline epoch means an extension naturally
    // produces a new reminder row and can never resurrect the old one.
    const before = reminderKey(SUBTASK, fromISTInput('2026-09-13T18:00'));
    const after = reminderKey(SUBTASK, fromISTInput('2026-09-16T18:00'));

    expect(before).not.toBe(after);
  });

  it('is stable for the same deadline expressed two ways', () => {
    // The same instant must produce the same key however it was constructed,
    // or a re-schedule would double-send.
    const viaIst = reminderKey(SUBTASK, fromISTInput('2026-09-13T18:00'));
    const viaUtc = reminderKey(SUBTASK, new Date('2026-09-13T12:30:00.000Z'));

    expect(viaIst).toBe(viaUtc);
  });

  it('distinguishes deadlines one minute apart', () => {
    expect(reminderKey(SUBTASK, fromISTInput('2026-09-13T18:00'))).not.toBe(
      reminderKey(SUBTASK, fromISTInput('2026-09-13T18:01')),
    );
  });

  it('distinguishes subtasks sharing a deadline', () => {
    const deadline = fromISTInput('2026-09-13T18:00');
    expect(reminderKey('sub-1', deadline)).not.toBe(reminderKey('sub-2', deadline));
  });
});

describe('overdue keys', () => {
  it('gives every escalation its own key, so none can repeat', () => {
    const keys = [1, 2, 3].map((n) => overdueMemberKey(SUBTASK, n));
    expect(new Set(keys).size).toBe(3);
  });

  it('gives every MD their own row for the same escalation', () => {
    // Two deputies must each be retryable and readable independently.
    const md = overdueMdKey(SUBTASK, 1, 'md-1');
    const deputy = overdueMdKey(SUBTASK, 1, 'deputy-1');

    expect(md).not.toBe(deputy);
  });

  it('keeps the member and MD keys distinct at the same escalation', () => {
    expect(overdueMemberKey(SUBTASK, 1)).not.toBe(overdueMdKey(SUBTASK, 1, USER));
  });
});

describe('digestKey', () => {
  it('is one per person per IST calendar day', () => {
    // 03:30 UTC is 09:00 IST — the digest hour. A UTC date would be right by
    // luck here and wrong the moment the digest time moved earlier.
    const morning = new Date('2026-09-13T03:30:00Z');
    expect(digestKey(USER, istDateKey(morning))).toBe('digest:user-1:2026-09-13');

    // 20:00 UTC on the 12th is already the 13th in IST.
    const lateUtc = new Date('2026-09-12T20:00:00Z');
    expect(digestKey(USER, istDateKey(lateUtc))).toBe('digest:user-1:2026-09-13');
  });

  it('differs per person on the same day', () => {
    expect(digestKey('md-1', '2026-09-13')).not.toBe(digestKey('deputy-1', '2026-09-13'));
  });
});

describe('every key builder', () => {
  it('produces a collision-free set across types for one subtask', () => {
    const deadline = fromISTInput('2026-09-13T18:00');
    const keys = [
      assignedKey(SUBTASK, USER),
      reminderKey(SUBTASK, deadline),
      overdueMemberKey(SUBTASK, 1),
      overdueMdKey(SUBTASK, 1, USER),
      deadlineChangedKey(SUBTASK, deadline, USER),
      problemRaisedKey('prob-1', USER),
      problemResolvedKey('prob-1', USER),
      jobCompletedKey('job-1', USER),
      digestKey(USER, '2026-09-13'),
    ];

    expect(new Set(keys).size).toBe(keys.length);
  });

  it('never contains a character that would break a key comparison', () => {
    const deadline = fromISTInput('2026-09-13T18:00');
    for (const key of [
      assignedKey(SUBTASK, USER),
      reminderKey(SUBTASK, deadline),
      overdueMdKey(SUBTASK, 3, USER),
      digestKey(USER, '2026-09-13'),
    ]) {
      expect(key).not.toMatch(/\s/);
      expect(key.length).toBeLessThan(255);
    }
  });
});
