/**
 * The task this chat is acting on.
 *
 * A notice, a button, or `/tasks` sets it. Commands use it after that message
 * has scrolled away. An open prompt (a date, a problem, a file) is left alone
 * so a new notice cannot wipe a confirmation that has not been answered.
 */
import { prisma } from '@/lib/db/prisma';

/** A selected task stays current far longer than a prompt, which expires in 15 minutes. */
const FOCUS_TTL_MS = 400 * 24 * 60 * 60 * 1000;

const PROMPTS = new Set([
  'SEVERITY',
  'PROBLEM_LOW',
  'PROBLEM_MEDIUM',
  'PROBLEM_HIGH',
  'OTHER',
  'CONFIRM',
  'FILE',
  'REJECT',
]);

export async function rememberFocus(
  chatId: string,
  userId: string,
  subtaskId: string,
  options?: { now?: Date; force?: boolean },
): Promise<void> {
  const now = options?.now ?? new Date();
  const pending = await prisma.telegramPending.findUnique({ where: { chatId } });
  if (
    !options?.force &&
    pending &&
    pending.userId === userId &&
    PROMPTS.has(pending.kind) &&
    pending.expiresAt.getTime() > now.getTime()
  ) {
    return;
  }

  const expiresAt = new Date(now.getTime() + FOCUS_TTL_MS);
  await prisma.telegramPending.upsert({
    where: { chatId },
    create: { chatId, userId, subtaskId, kind: 'FOCUS', deadline: null, expiresAt },
    update: { userId, subtaskId, kind: 'FOCUS', deadline: null, expiresAt },
  });
}
