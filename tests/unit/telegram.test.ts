import { afterEach, describe, expect, it } from 'vitest';

import { PermanentChannelError, TransientChannelError } from '@/lib/notifications/channels/types';
import type { ProblemRaisedPayload } from '@/lib/notifications/templates/types';
import { parseDayMonth } from '@/lib/telegram/dates';
import { telegramReplyShouldRetry } from '@/lib/telegram/handle-update';
import { webhookAuthorized } from '@/lib/telegram/secret';
import { actionsFor, plainTextFor } from '@/lib/telegram/text';

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
    expect(text.startsWith('JGE-2026-0004 — Valve body')).toBe(true);
    expect(text).toContain('Part / drawing VB-100');
    expect(text).toContain('Purchase · Purchase');
    expect(text).toContain('Assigned to Meena');
    expect(text).toContain('x'.repeat(500));
    expect(text.length).toBeLessThanOrEqual(4000);
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
