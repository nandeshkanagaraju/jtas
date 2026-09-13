/**
 * Deep links into the exact action — PDD improvement I-14.
 *
 * "Two taps from mail to status update." Every link is absolute and built from
 * `APP_BASE_URL`, because a relative URL in an email goes nowhere.
 */
import { env } from '@/lib/utils/env';

function base(): string {
  return env().APP_BASE_URL.replace(/\/+$/, '');
}

/** The member's subtask screen, optionally with a control already open. */
export function subtaskLink(subtaskId: string, action?: 'complete' | 'problem'): string {
  const suffix = action ? `?action=${action}` : '';
  return `${base()}/tasks/${subtaskId}${suffix}`;
}

export function jobLink(jobId: string): string {
  return `${base()}/jobs/${jobId}`;
}

export function problemInboxLink(): string {
  return `${base()}/problems`;
}

export function myTasksLink(): string {
  return `${base()}/my-tasks`;
}

export function dashboardLink(): string {
  return `${base()}/dashboard`;
}
