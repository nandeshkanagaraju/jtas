import { afterEach, describe, expect, it } from 'vitest';

import { PermanentChannelError, TransientChannelError } from '@/lib/notifications/channels/types';
import type { ProblemRaisedPayload } from '@/lib/notifications/templates/types';
import { parseDayMonth } from '@/lib/telegram/dates';
import { telegramReplyShouldRetry } from '@/lib/telegram/handle-update';
import { webhookAuthorized } from '@/lib/telegram/secret';
import { actionsFor, plainTextFor } from '@/lib/telegram/text';
import type { JobTimeline } from '@/lib/telegram/timeline';

describe('telegram text', () => {
  it('carries the job, the part, the assignee and the full problem', () => {
    const payload: ProblemRaisedPayload = {
      kind: 'PROBLEM_RAISED',
      subtaskId: 'sub',
      jobId: 'job',
      subtaskTitle: 'Purchase',
      departmentName: 'Purchase',
      assigneeName: 'Meena',
      deadlineIst: 'Not committed',
      status: 'problem',
      jobCode: 'JGE-2026-0004',
      jobTitle: 'Valve body',
      partNumber: 'VB-100',
      drawingNumber: null,
      problemId: 'prob',
      severity: 'MEDIUM',
      description: 'x'.repeat(500),
      raisedByName: 'Meena',
    };

    const text = plainTextFor(payload);
    expect(text.startsWith('JGE-2026-0004')).toBe(true);
    expect(text).toContain('Valve body');
    expect(text).toContain('Part: VB-100');
    expect(text).toContain('Purchase — Purchase');
    expect(text).toContain('Assigned to: Meena');
    expect(text).toContain('What to do');
    expect(text).toContain('x'.repeat(500));
    expect(text.length).toBeLessThanOrEqual(4000);
  });

  it('lays the job out as a timeline, with the previous date and what they recorded', () => {
    const timeline: JobTimeline = {
      quantity: 12,
      description: 'Trial batch for the new fixture.',
      createdByName: 'Managing Director',
      steps: [
        {
          id: 'store',
          assigneeId: 'store-user',
          dependsOnId: null,
          departmentName: 'Store',
          title: 'Receive raw material',
          assigneeName: 'Store Member',
          status: 'COMPLETED',
          statusLine: 'Finished 6 Oct 2026, 4:00 PM',
          finishDate: '6 Oct 2026, 6:00 PM',
          recorded: 'Accepted 10, rejected 2. Material is on the rack.',
          description: null,
          problems: ['Problem (open, medium): Supplier sent the wrong grade on the first lot.'],
        },
        {
          id: 'prod',
          assigneeId: 'prod-user',
          dependsOnId: 'store',
          departmentName: 'Production',
          title: 'Machine the bracket',
          assigneeName: 'Production Member',
          status: 'PENDING',
          statusLine: 'Choosing a finish date',
          finishDate: null,
          recorded: null,
          description: 'Machine to drawing DRG-TB-100.',
          problems: [],
        },
      ],
    };

    const text = plainTextFor(
      {
        kind: 'COMMITMENT_OPEN',
        subtaskId: 'prod',
        jobId: 'job',
        subtaskTitle: 'Machine the bracket',
        departmentName: 'Production',
        assigneeName: 'Production Member',
        deadlineIst: 'Not committed',
        status: 'pending',
        jobCode: 'JGE-2026-0003',
        jobTitle: 'Telegram trial bracket',
        partNumber: 'TB-100',
        drawingNumber: 'DRG-TB-100',
        commitmentDueIst: '8 Oct 2026, 1:15 AM',
        minutesLeft: 1400,
      },
      timeline,
      'prod-user',
    );

    expect(text).toContain('Opened by: Managing Director');
    expect(text).toContain('Quantity: 12');
    expect(text).toContain('Your task');
    expect(text).toContain('Production — Machine the bracket  ← you');
    expect(text).toContain('Their finish date was 6 Oct 2026, 6:00 PM');
    expect(text).toContain('Accepted 10, rejected 2');
    expect(text).toContain('Supplier sent the wrong grade');
    expect(text).toContain('Finish date: not set yet');
    expect(text).toContain('What to do');
  });

  it('offers date buttons on a missed commitment, and a file button on the task', () => {
    const open = actionsFor({
      kind: 'COMMITMENT_MISSED_MEMBER',
      subtaskId: 'sub',
      jobId: 'job',
      subtaskTitle: 'Store',
      departmentName: 'Store',
      assigneeName: 'Meena',
      deadlineIst: 'Not committed',
      status: 'pending',
      jobCode: 'JGE-2026-0004',
      jobTitle: 'Valve body',
      partNumber: 'VB-100',
      drawingNumber: 'DWG-1',
      commitmentDueIst: '7 Oct 2026, 6:00 PM',
      delayMinutes: 30,
    });
    expect(open.flat().map((button) => button.label)).toEqual([
      '+2 days',
      '+5 days',
      '+1 week',
      'Other date',
      'Attach a file',
    ]);
  });
});

describe('telegram dates', () => {
  const now = new Date('2026-10-06T06:00:00.000Z');

  it('reads DD/MM as 6:00 PM IST', () => {
    expect(parseDayMonth('12/10', now)).toBe('2026-10-12T18:00');
  });

  it('rejects a day that does not exist', () => {
    expect(parseDayMonth('31/02', now)).toBeNull();
    expect(parseDayMonth('hello', now)).toBeNull();
  });
});

describe('telegram webhook secret', () => {
  const previous = process.env.TELEGRAM_WEBHOOK_SECRET;

  afterEach(() => {
    if (previous === undefined) delete process.env.TELEGRAM_WEBHOOK_SECRET;
    else process.env.TELEGRAM_WEBHOOK_SECRET = previous;
  });

  it('accepts only the configured secret', () => {
    process.env.TELEGRAM_WEBHOOK_SECRET = 'correct-secret-value';
    expect(webhookAuthorized('correct-secret-value')).toBe(true);
    expect(webhookAuthorized('correct-secret-valuX')).toBe(false);
    expect(webhookAuthorized(null)).toBe(false);
    expect(webhookAuthorized('')).toBe(false);
  });

  it('rejects every call when no secret is configured', () => {
    delete process.env.TELEGRAM_WEBHOOK_SECRET;
    expect(webhookAuthorized('anything')).toBe(false);
  });
});

describe('telegram reply failures', () => {
  it('does not ask Telegram to retry a missing token', () => {
    expect(telegramReplyShouldRetry(new PermanentChannelError('Telegram is not configured.'))).toBe(
      false,
    );
  });

  it('asks Telegram to retry a transient send failure', () => {
    expect(telegramReplyShouldRetry(new TransientChannelError('Telegram is unavailable.'))).toBe(
      true,
    );
  });
});
