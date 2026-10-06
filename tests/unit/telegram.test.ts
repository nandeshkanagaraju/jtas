import { afterEach, describe, expect, it } from 'vitest';

import { parseDayMonth } from '@/lib/telegram/dates';
import { webhookAuthorized } from '@/lib/telegram/secret';
import { plainTextFor } from '@/lib/telegram/text';
import type { ProblemRaisedPayload } from '@/lib/notifications/templates/types';

describe('telegram text', () => {
  it('leads with the job code and part number and stays under 300 characters', () => {
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
    expect(text.startsWith('JGE-2026-0004 · VB-100')).toBe(true);
    expect(text.length).toBeLessThanOrEqual(300);
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
