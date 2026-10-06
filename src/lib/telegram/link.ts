/**
 * Linking a person's own Telegram chat.
 *
 * The code is created while they are signed in. It is spent when the bot
 * receives `/start <code>` from a private chat. A wrong code is not a match
 * and produces no reply.
 */
import crypto from 'node:crypto';

import { prisma } from '@/lib/db/prisma';
import { writeAudit } from '@/lib/services/audit-service';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_TTL_MS = 15 * 60 * 1000;

export function generateLinkCode(): string {
  let code = '';
  for (let i = 0; i < 8; i++) code += ALPHABET[crypto.randomInt(ALPHABET.length)];
  return code;
}

export async function issueLinkCode(
  userId: string,
  now: Date = new Date(),
): Promise<{ code: string; expiresAt: Date }> {
  const expiresAt = new Date(now.getTime() + CODE_TTL_MS);
  const code = generateLinkCode();

  await prisma.$transaction([
    prisma.telegramLinkCode.updateMany({
      where: { userId, usedAt: null },
      data: { usedAt: now },
    }),
    prisma.telegramLinkCode.create({ data: { userId, code, expiresAt } }),
  ]);

  return { code, expiresAt };
}

export type ConsumeResult =
  | { outcome: 'linked'; name: string }
  | { outcome: 'refused'; reason: 'used' | 'taken' }
  | { outcome: 'unknown' };

/**
 * Spends a code and stores the chat id.
 *
 * `unknown` means the code does not exist. The caller stays silent.
 * `refused` means the code was real and cannot be used.
 */
export async function consumeLinkCode(
  rawCode: string,
  chatId: string,
  now: Date = new Date(),
): Promise<ConsumeResult> {
  const code = rawCode.trim().toUpperCase();
  const row = await prisma.telegramLinkCode.findUnique({
    where: { code },
    select: {
      id: true,
      userId: true,
      expiresAt: true,
      usedAt: true,
      user: { select: { name: true } },
    },
  });

  if (!row) return { outcome: 'unknown' };
  if (row.usedAt || row.expiresAt.getTime() <= now.getTime())
    return { outcome: 'refused', reason: 'used' };

  const taken = await prisma.user.findUnique({
    where: { telegramChatId: chatId },
    select: { id: true },
  });
  if (taken && taken.id !== row.userId) return { outcome: 'refused', reason: 'taken' };

  const spent = await prisma.$transaction(async (tx) => {
    const claimed = await tx.telegramLinkCode.updateMany({
      where: { id: row.id, usedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    });
    if (claimed.count !== 1) return false;

    await tx.user.update({
      where: { id: row.userId },
      data: { telegramChatId: chatId },
    });
    await tx.telegramPending.deleteMany({ where: { userId: row.userId } });
    await writeAudit(tx, {
      actorId: row.userId,
      action: 'TELEGRAM_LINKED',
      entityType: 'USER',
      entityId: row.userId,
      after: { linked: true },
      source: 'TELEGRAM',
    });
    return true;
  });

  if (!spent) return { outcome: 'refused', reason: 'used' };
  return { outcome: 'linked', name: row.user.name };
}

export async function unlinkTelegram(userId: string, ipAddress: string | null): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { telegramChatId: true },
  });
  if (!user?.telegramChatId) return false;

  await prisma.$transaction(async (tx) => {
    await tx.telegramPending.deleteMany({ where: { userId } });
    await tx.user.update({ where: { id: userId }, data: { telegramChatId: null } });
    await writeAudit(tx, {
      actorId: userId,
      action: 'TELEGRAM_UNLINKED',
      entityType: 'USER',
      entityId: userId,
      after: { linked: false },
      ipAddress,
      source: 'WEB',
    });
  });

  return true;
}
