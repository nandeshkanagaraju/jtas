/**
 * The channel contract — SDD section 5.5.
 *
 * "Adding a channel never touches the sweeper." The sweeper resolves a channel
 * from the registry by the row's `channel` column and calls `send`; WhatsApp in
 * Phase 3 is a new file and one registry entry (FR-59, improvement I-07).
 */
import type { NotifChannel } from '@prisma/client';

/** Everything a channel needs to deliver one notification. */
export interface OutboundNotification {
  id: string;
  type: string;
  subject: string;
  /** Plain-text body, already rendered. */
  body: string;
  /** HTML body when the channel can use one. */
  html?: string;
  entityType: string;
  entityId: string;
}

export interface ChannelRecipient {
  id: string;
  name: string;
  email: string;
  phone: string | null;
}

export interface SendResult {
  /** The provider's own id, recorded so a bounce can be traced back. */
  providerId?: string;
}

export interface NotificationChannel {
  key: NotifChannel;
  send(notification: OutboundNotification, user: ChannelRecipient): Promise<SendResult>;
}

/**
 * A delivery failure the sweeper should retry.
 *
 * Distinguished from a permanent one because retrying a malformed address
 * forever is how a queue fills up and a real failure gets buried.
 */
export class TransientChannelError extends Error {
  readonly retryable = true;

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'TransientChannelError';
  }
}

/** A failure no amount of retrying will fix — a bad address, a rejected domain. */
export class PermanentChannelError extends Error {
  readonly retryable = false;

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'PermanentChannelError';
  }
}

export function isRetryable(error: unknown): boolean {
  if (error instanceof PermanentChannelError) return false;
  if (error instanceof TransientChannelError) return true;
  // An unknown failure is assumed transient: a mail delayed is recoverable, a
  // mail dropped is not.
  return true;
}
