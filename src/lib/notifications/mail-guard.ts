/**
 * The two guards that stand between the sweeper and a real mail relay.
 *
 * Both exist because the failure they prevent is silent and expensive, and
 * because the moment `MAIL_PROVIDER=brevo` is set there is no undo: a message
 * accepted by a provider is gone, and a bounce is charged against the sending
 * reputation of an address that has to keep working afterwards.
 *
 *   ALLOWLIST  while the roster still holds addresses nobody reads, only the
 *              named ones receive mail. Everything else is written as
 *              SUPPRESSED, with the reason on the row, and stays visible in
 *              the recipient's in-app inbox so a flow can still be tested
 *              end to end without a single message leaving the building.
 *
 *   DAILY CAP  Brevo's free tier allows 300 transactional mails a day. The cap
 *              defaults to 250, leaving headroom for a password reset or a
 *              test send. Rows over the cap stay PENDING rather than FAILED,
 *              because nothing is wrong with them: they go out after midnight.
 *
 * Neither guard normalises an address. `+hr@` is a different mailbox from the
 * bare address as far as this file is concerned — collapsing the two is how a
 * plus-tagged roster would quietly acquire delivery to an address nobody put
 * on the list.
 */
import type { Db } from '@/lib/db/prisma';
import { startOfISTDay, startOfNextISTDay } from '@/lib/utils/time';

/** Brevo's free transactional allowance, for the headroom comment above. */
export const BREVO_FREE_DAILY_LIMIT = 300;

export const DEFAULT_DAILY_CAP = 250;

/**
 * Splits `MAIL_ALLOWLIST` into exact addresses.
 *
 * Case is folded because mailbox comparison is case-insensitive in every
 * practical sense and the column is already stored lowercase. Nothing else is
 * touched: no plus-tag stripping, no dot folding, no domain aliasing.
 */
export function parseAllowlist(raw: string | undefined): string[] {
  if (!raw) return [];

  return raw
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);
}

/**
 * Whether an address may be mailed.
 *
 * An empty allowlist means the guard is off and everything is allowed — the
 * production posture, where the roster is real. A non-empty one is a closed
 * list: an address absent from it is refused, including one that differs only
 * by its plus-tag.
 */
export function isAllowedRecipient(email: string, allowlist: readonly string[]): boolean {
  if (allowlist.length === 0) return true;
  return allowlist.includes(email.trim().toLowerCase());
}

/** The reason written onto a suppressed row, so the inbox can explain itself. */
export function suppressionReason(email: string): string {
  return (
    `Not delivered: ${email} is not on MAIL_ALLOWLIST. ` +
    `The notification was raised correctly and is shown here; only the email was withheld.`
  );
}

export interface QuotaStatus {
  /** Mails sent so far in the current IST day. */
  sentToday: number;
  cap: number;
  remaining: number;
  /** True when nothing more may be dispatched until the IST day rolls over. */
  exhausted: boolean;
  /** When the allowance resets — the next IST midnight, in UTC. */
  resetsAt: Date;
}

/**
 * Counts what has actually left the building today and what is left.
 *
 * Counted on `sentAt` rather than `createdAt`: the cap is on *delivery*, and a
 * row queued yesterday that goes out this morning spends today's allowance.
 * Suppressed rows are deliberately not counted — nothing was sent.
 *
 * The day is an IST day because that is the day the factory works, and because
 * a cap that rolled over at 05:30 local time would empty mid-morning.
 */
export async function quotaStatus(
  db: Db,
  cap: number = DEFAULT_DAILY_CAP,
  now: Date = new Date(),
): Promise<QuotaStatus> {
  const sentToday = await db.notification.count({
    where: {
      channel: 'EMAIL',
      status: 'SENT',
      sentAt: { gte: startOfISTDay(now), lt: startOfNextISTDay(now) },
    },
  });

  const remaining = Math.max(0, cap - sentToday);

  return {
    sentToday,
    cap,
    remaining,
    exhausted: remaining <= 0,
    resetsAt: startOfNextISTDay(now),
  };
}

/** How many rows were withheld today, for the health endpoint. */
export async function suppressedToday(db: Db, now: Date = new Date()): Promise<number> {
  return db.notification.count({
    where: {
      status: 'SUPPRESSED',
      createdAt: { gte: startOfISTDay(now), lt: startOfNextISTDay(now) },
    },
  });
}

/** The effective mail guard configuration, read from the environment. */
export function mailGuardConfig(env: NodeJS.ProcessEnv = process.env): {
  allowlist: string[];
  cap: number;
  pushEnabled: boolean;
} {
  const rawCap = Number.parseInt(env.MAIL_DAILY_CAP ?? '', 10);

  return {
    allowlist: parseAllowlist(env.MAIL_ALLOWLIST),
    cap: Number.isFinite(rawCap) && rawCap > 0 ? rawCap : DEFAULT_DAILY_CAP,
    // Push is gated separately, so either channel can be turned off alone.
    pushEnabled: env.PUSH_ENABLED === 'true',
  };
}
