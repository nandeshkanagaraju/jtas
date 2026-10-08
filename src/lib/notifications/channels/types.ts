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
  /** Present when the recipient can act from the message. */
  actions?: OutboundAction[][];
  /**
   * A message sent first, with no buttons. Telegram uses it for the job
   * timeline; the body that follows is the task.
   */
  preface?: string;
}

export interface ChannelRecipient {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  /** Set when the channel addresses a linked chat. Email ignores it. */
  telegramChatId?: string | null;
}

/** A button on an outbound message. `data` is opaque to the channel. */
export interface OutboundAction {
  label: string;
  data: string;
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

/**
 * The provider's own allowance is gone for the day.
 *
 * Neither transient nor permanent, which is why it is its own type. Retrying
 * inside the hour is pointless — the limit does not move until the provider's
 * day rolls over — but the message is perfectly good and must not be failed.
 * The sweeper stops the pass on this and leaves the row PENDING, exactly as it
 * does for our own `MAIL_DAILY_CAP`; the difference is only who counted.
 */
export class ProviderQuotaError extends Error {
  readonly retryable = true;

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'ProviderQuotaError';
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
