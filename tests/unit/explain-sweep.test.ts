import { describe, expect, it } from 'vitest';

import { explainSweep, type ExplainSweepInput } from '@/lib/notifications/explain-sweep';
import { overdueFilterVerdicts, skippedReminderReason } from '@/lib/notifications/sweep-filters';
import { DEFAULT_WORKING_HOURS } from '@/lib/notifications/working-hours';

const NOW = new Date('2026-09-29T18:05:00.000Z');
const DEADLINE = new Date('2026-09-29T18:00:00.000Z');

function input(overrides: Partial<ExplainSweepInput> = {}): ExplainSweepInput {
  return {
    now: NOW,
    subtask: {
      id: 'sub-1',
      title: 'Machine the housing',
      status: 'PENDING',
      deadline: DEADLINE,
      reminderLeadMinutes: 720,
      escalationCount: 0,
      lastEscalatedAt: null,
    },
    job: {
      jobCode: 'JGE-2026-0033',
      title: 'Spindle Housing Batch',
      status: 'AT_RISK',
      isDemo: false,
    },
    assignee: {
      name: 'Production Member',
      email: 'member08@gmail.com',
      isActive: true,
      isDemo: false,
    },
    notifications: [],
    commanders: [{ email: 'md@gmail.com', isDemo: false, isActive: true }],
    heartbeatAt: new Date('2026-09-29T15:00:00.000Z'),
    schedulerIntervalMinutes: 5,
    staleAfterMinutes: 20,
    escalation: { intervalMinutes: 240, maxCount: 3 },
    workingHours: DEFAULT_WORKING_HOURS,
    suppressOutsideHours: true,
    allowlist: ['md@gmail.com'],
    quota: { sentToday: 0, cap: 250, exhausted: false },
    provider: 'brevo',
    senderEmail: 'md@gmail.com',
    ...overrides,
  };
}

describe('overdueFilterVerdicts', () => {
  it('passes a live overdue subtask on a real job', () => {
    const verdicts = overdueFilterVerdicts({
      now: NOW,
      deadline: DEADLINE,
      subtaskStatus: 'PENDING',
      jobStatus: 'AT_RISK',
      jobIsDemo: false,
      escalationCount: 0,
      maxEscalations: 3,
      lastEscalatedAt: null,
      intervalMinutes: 240,
    });

    expect(verdicts.every((verdict) => verdict.passed)).toBe(true);
  });

  it('prints the next chase as lastEscalatedAt plus the interval, and agrees with escalateOverdue', () => {
    const lastEscalatedAt = new Date('2026-09-29T15:48:30.000Z');
    const intervalMinutes = 240;
    const nextAllowed = new Date(lastEscalatedAt.getTime() + intervalMinutes * 60_000);

    // Inside the window, on the exact boundary, and one minute past it.
    // escalateOverdue selects `lastEscalatedAt < now - interval` (strict).
    for (const now of [
      new Date(nextAllowed.getTime() - 60_000),
      nextAllowed,
      new Date(nextAllowed.getTime() + 60_000),
    ]) {
      const cutoff = new Date(now.getTime() - intervalMinutes * 60_000);
      const sweeperWouldSelect = lastEscalatedAt.getTime() < cutoff.getTime();

      const verdicts = overdueFilterVerdicts({
        now,
        deadline: new Date(now.getTime() - 60_000),
        subtaskStatus: 'IN_PROGRESS',
        jobStatus: 'AT_RISK',
        jobIsDemo: false,
        escalationCount: 1,
        maxEscalations: 3,
        lastEscalatedAt,
        intervalMinutes,
      });
      const check = verdicts.find(
        (verdict) => verdict.name === 'enough time since the last escalation',
      );

      expect(check?.passed).toBe(sweeperWouldSelect);
      expect(check?.detail).toBe(
        `last escalated ${lastEscalatedAt.toISOString()}, next allowed after ${nextAllowed.toISOString()} (every ${intervalMinutes} minutes)`,
      );

      const report = explainSweep(
        input({
          now,
          subtask: {
            id: 'sub-1',
            title: 'Machine the housing',
            status: 'IN_PROGRESS',
            deadline: new Date(now.getTime() - 60_000),
            reminderLeadMinutes: 720,
            escalationCount: 1,
            lastEscalatedAt,
          },
        }),
      );
      expect(report).toContain(`next allowed after ${nextAllowed.toISOString()}`);
      expect(report).toContain(
        sweeperWouldSelect
          ? 'PASS  enough time since the last escalation'
          : 'FAIL  enough time since the last escalation',
      );
    }
  });

  it('names the demonstration-data exclusion', () => {
    const verdicts = overdueFilterVerdicts({
      now: NOW,
      deadline: DEADLINE,
      subtaskStatus: 'PENDING',
      jobStatus: 'DELAYED',
      jobIsDemo: true,
      escalationCount: 0,
      maxEscalations: 3,
      lastEscalatedAt: null,
      intervalMinutes: 240,
    });

    const demo = verdicts.find((verdict) => verdict.name === 'job is not demonstration data');
    expect(demo?.passed).toBe(false);
  });
});

describe('explainSweep', () => {
  it('says a stale worker stopped the sweep, and the assignee would be suppressed', () => {
    const report = explainSweep(input());

    expect(report).toContain('FAIL  the worker is not sweeping');
    expect(report).toContain('schedulerHeartbeatAgeSeconds');
    expect(report).toContain('would queue overdue mail');
    expect(report).toContain('SUPPRESS without sending');
    expect(report).toContain('member08@gmail.com');
    expect(report).toContain('SEND via brevo');
    expect(report).toContain('Not scheduled');
    expect(report).toContain('Nothing was sent or written');
  });

  it('names a passed reminder moment the same way the scheduler records it', () => {
    const remindAt = new Date(DEADLINE.getTime() - 720 * 60_000);
    const reason = skippedReminderReason({
      reminderLeadMinutes: 720,
      remindAt,
      savedAt: NOW,
    });

    expect(reason).toContain('720 minutes');
    expect(reason).toContain(remindAt.toISOString());
    expect(explainSweep(input())).toContain('Not scheduled');
  });
});
