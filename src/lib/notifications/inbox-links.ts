/**
 * Where each in-app notification takes you when it is opened.
 *
 * Separate from `templates/links.ts`, which builds absolute URLs for email.
 * Pure, so the routing can be asserted without rendering the inbox.
 */

export interface LinkableNotification {
  type: string;
  entityType: string;
  entityId: string;
}

/**
 * The destination for one notification.
 *
 * The same idea as improvement I-14, which is specifically about deep links
 * *from email* into the exact action — this applies it to the in-app inbox,
 * which the documents do not cover.
 */
export function inboxLinkFor(item: LinkableNotification): string {
  /*
   * Type wins over entity for anything that is not about a single record. The
   * digest is about a whole day, so its entityId is an IST date key rather than
   * an id — following entityType would send the reader to /jobs/2026-09-13 and
   * a 404.
   */
  if (item.type === 'DAILY_DIGEST_MD') return '/dashboard';

  if (item.entityType === 'SUBTASK') return `/tasks/${item.entityId}`;
  if (item.entityType === 'JOB') return `/jobs/${item.entityId}`;
  if (item.entityType === 'PROBLEM') return '/problems';

  // A notification with nowhere to go is still better pointed at the reader's
  // own work than at a dead URL.
  return '/my-tasks';
}
