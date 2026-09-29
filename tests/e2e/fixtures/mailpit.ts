/**
 * Mailpit helper for end-to-end assertions.
 *
 * Provides functions to inspect and clear emails captured by the Mailpit
 * SMTP server running during local development and E2E tests.
 */

export interface MailAddress {
  Name: string;
  Address: string;
}

export interface MailpitSummary {
  ID: string;
  MessageID: string;
  From: MailAddress;
  To: MailAddress[];
  Subject: string;
  Created: string;
  Snippet: string;
}

export interface MailpitMessageDetail extends MailpitSummary {
  Text: string;
  HTML: string;
}

export interface MailpitListResponse {
  total: number;
  unread: number;
  count: number;
  messages: MailpitSummary[];
}

const MAILPIT_BASE_URL = process.env.MAILPIT_URL || 'http://localhost:8025';

export async function clearMailpit(): Promise<void> {
  try {
    const res = await fetch(`${MAILPIT_BASE_URL}/api/v1/messages`, { method: 'DELETE' });
    if (!res.ok) {
      console.warn(`[mailpit] clear returned HTTP ${res.status}`);
    }
  } catch (error) {
    console.warn('[mailpit] failed to clear messages:', error);
  }
}

export async function getMailpitMessages(): Promise<MailpitSummary[]> {
  const res = await fetch(`${MAILPIT_BASE_URL}/api/v1/messages`);
  if (!res.ok) {
    throw new Error(`Failed to fetch Mailpit messages: HTTP ${res.status} ${res.statusText}`);
  }
  const data = (await res.json()) as MailpitListResponse;
  return data.messages || [];
}

export async function getMailpitMessageDetail(id: string): Promise<MailpitMessageDetail> {
  const res = await fetch(`${MAILPIT_BASE_URL}/api/v1/message/${id}`);
  if (!res.ok) {
    throw new Error(`Failed to fetch Mailpit message ${id}: HTTP ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as MailpitMessageDetail;
}

export async function findMailpitMessage(
  predicate: (msg: MailpitSummary) => boolean,
): Promise<MailpitSummary | undefined> {
  const messages = await getMailpitMessages();
  return messages.find(predicate);
}
