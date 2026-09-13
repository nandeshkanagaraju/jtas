import { describe, expect, it } from 'vitest';

import { inboxLinkFor } from '@/lib/notifications/inbox-links';

describe('inboxLinkFor', () => {
  it('opens a subtask notification on that subtask', () => {
    expect(inboxLinkFor({ type: 'OVERDUE_MD', entityType: 'SUBTASK', entityId: 'sub-1' })).toBe(
      '/tasks/sub-1',
    );
  });

  it('opens a job notification on that job', () => {
    expect(inboxLinkFor({ type: 'JOB_COMPLETED', entityType: 'JOB', entityId: 'job-1' })).toBe(
      '/jobs/job-1',
    );
  });

  it('sends the daily digest to the dashboard, not to a job id', () => {
    // The digest's entityId is an IST date key. Routing it by entityType
    // produced /jobs/2026-09-13 — a 404 at the end of the MD's morning mail.
    expect(
      inboxLinkFor({ type: 'DAILY_DIGEST_MD', entityType: 'JOB', entityId: '2026-09-13' }),
    ).toBe('/dashboard');
  });

  it('sends a problem notification to the problem inbox when it names no subtask', () => {
    expect(
      inboxLinkFor({ type: 'PROBLEM_RAISED', entityType: 'PROBLEM', entityId: 'prob-1' }),
    ).toBe('/problems');
  });

  it('prefers the subtask when a problem notification names one', () => {
    // The subtask page is where the problem and its resolution both live.
    expect(inboxLinkFor({ type: 'PROBLEM_RAISED', entityType: 'SUBTASK', entityId: 'sub-9' })).toBe(
      '/tasks/sub-9',
    );
  });

  it('falls back to the reader’s own work rather than a dead URL', () => {
    expect(inboxLinkFor({ type: 'SOMETHING_NEW', entityType: 'SETTING', entityId: 'x' })).toBe(
      '/my-tasks',
    );
  });

  it('never returns an empty or absolute link', () => {
    const cases = [
      { type: 'SUBTASK_ASSIGNED', entityType: 'SUBTASK', entityId: 's' },
      { type: 'DAILY_DIGEST_MD', entityType: 'JOB', entityId: '2026-09-13' },
      { type: 'EXTENSION_REQUESTED', entityType: 'SUBTASK', entityId: 's' },
      { type: 'unknown', entityType: 'unknown', entityId: '' },
    ];

    for (const item of cases) {
      const link = inboxLinkFor(item);
      expect(link.startsWith('/')).toBe(true);
      expect(link).not.toMatch(/^https?:/);
    }
  });
});
