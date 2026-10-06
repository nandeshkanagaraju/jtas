/**
 * Inbound Telegram updates.
 *
 * Buttons and typed replies both call the same services the web app calls.
 * A chat that is not linked to a user gets no message back.
 */
import type { Role } from '@prisma/client';

import { prisma } from '@/lib/db/prisma';
import { AppError } from '@/lib/errors';
import { changeStatus, commitDeadline } from '@/lib/services/subtasks';
import { moduleLogger } from '@/lib/utils/logger';

import { sendTelegramMessage, telegramApi } from './api';
import { commitmentChoice, formatCommitment, parseDayMonth } from './dates';
import { consumeLinkCode } from './link';

const log = moduleLogger('telegram');

const PENDING_TTL_MS = 15 * 60 * 1000;

const ALREADY_COMMITTED =
  'This date is already committed. You cannot move it. Ask the MD for more time.';

export interface TelegramUpdate {
  message?: {
    text?: string;
    chat: { id: number; type?: string };
  };
  callback_query?: {
    id: string;
    data?: string;
    message?: { chat: { id: number; type?: string } };
  };
}

interface LinkedUser {
  id: string;
  role: Role;
  name: string;
}

const telegramCtx = { ipAddress: null, source: 'TELEGRAM' as const };

export async function handleTelegramUpdate(
  update: TelegramUpdate,
  now: Date = new Date(),
): Promise<void> {
  try {
    const callback = update.callback_query;
    const message = update.message;
    const chat = callback?.message?.chat ?? message?.chat;
    if (!chat) return;

    if (chat.type && chat.type !== 'private') {
      if (callback) await acknowledge(callback.id);
      return;
    }

    const chatId = String(chat.id);
    const text = message?.text?.trim();

    if (text && /^\/start(?:@\S+)?(?:\s|$)/.test(text)) {
      await handleStart(chatId, text, now);
      return;
    }

    const user = await linkedUser(chatId);
    if (!user) {
      if (callback) await acknowledge(callback.id);
      return;
    }

    if (callback) {
      await acknowledge(callback.id);
      if (callback.data) await handleCallback(chatId, user, callback.data, now);
      return;
    }

    if (text) await handleText(chatId, user, text, now);
  } catch (error) {
    log.error({ err: error }, 'telegram update failed');
  }
}

async function acknowledge(callbackId: string): Promise<void> {
  try {
    await telegramApi('answerCallbackQuery', { callback_query_id: callbackId });
  } catch (error) {
    log.warn({ err: error }, 'telegram callback acknowledgement failed');
  }
}

async function reply(
  chatId: string,
  text: string,
  buttons?: { text: string; callback_data: string }[][],
): Promise<void> {
  await sendTelegramMessage({ chatId, text, buttons });
}

async function linkedUser(chatId: string): Promise<LinkedUser | null> {
  const user = await prisma.user.findUnique({
    where: { telegramChatId: chatId },
    select: { id: true, role: true, name: true, isActive: true },
  });
  if (!user?.isActive) return null;
  return user;
}

async function handleStart(chatId: string, text: string, now: Date): Promise<void> {
  const code = /^\/start(?:@\S+)?(?:\s+(\S+))?/.exec(text)?.[1];
  if (!code) {
    const existing = await linkedUser(chatId);
    if (existing) {
      await reply(chatId, `Already linked as ${existing.name}. Email still arrives as well.`);
    }
    return;
  }

  const result = await consumeLinkCode(code, chatId, now);
  if (result.outcome === 'unknown') return;
  if (result.outcome === 'refused') {
    const message =
      result.reason === 'taken'
        ? 'This Telegram is already linked to another account.'
        : 'That code has already been used. Generate a new one from your JTAS account.';
    await reply(chatId, message);
    return;
  }

  await reply(
    chatId,
    `Linked as ${result.name}. JTAS will message you here as well as by email. Email still arrives if this phone is off.`,
  );
}

async function handleCallback(
  chatId: string,
  user: LinkedUser,
  data: string,
  now: Date,
): Promise<void> {
  const splitAt = data.indexOf(':');
  if (splitAt < 1) return;
  const action = data.slice(0, splitAt);
  const subtaskId = data.slice(splitAt + 1);
  if (!subtaskId) return;

  if (action === 'done') {
    await markCompleted(chatId, user, subtaskId);
    return;
  }
  if (action === 'prob') {
    await askForProblem(chatId, user, subtaskId, now);
    return;
  }
  if (action === 'd2' || action === 'd5' || action === 'd7') {
    const days = action === 'd2' ? 2 : action === 'd5' ? 5 : 7;
    await proposeCommitment(chatId, user, subtaskId, commitmentChoice(now, days), now);
    return;
  }
  if (action === 'd0') {
    await askForDate(chatId, user, subtaskId, now);
    return;
  }
  if (action === 'yes') {
    await confirmCommitment(chatId, user, subtaskId, now);
    return;
  }
  if (action === 'no') {
    await prisma.telegramPending.deleteMany({ where: { chatId, subtaskId } });
    await reply(chatId, 'Cancelled. Nothing was saved.');
  }
}

async function handleText(
  chatId: string,
  user: LinkedUser,
  text: string,
  now: Date,
): Promise<void> {
  const pending = await prisma.telegramPending.findUnique({ where: { chatId } });
  if (!pending || pending.userId !== user.id || pending.expiresAt.getTime() <= now.getTime()) {
    if (pending) await prisma.telegramPending.delete({ where: { chatId } });
    await reply(chatId, 'Use the buttons on the JTAS message.');
    return;
  }

  if (pending.kind === 'PROBLEM') {
    await raiseFromChat(chatId, user, pending.subtaskId, text);
    return;
  }

  if (pending.kind === 'OTHER') {
    const value = parseDayMonth(text, now);
    if (!value) {
      await reply(chatId, 'Send the date as DD/MM, for example 12/10.');
      return;
    }
    await proposeCommitment(chatId, user, pending.subtaskId, value, now);
  }
}

async function markCompleted(chatId: string, user: LinkedUser, subtaskId: string): Promise<void> {
  try {
    const result = await changeStatus(
      subtaskId,
      { action: 'COMPLETE' },
      { id: user.id, role: user.role },
      telegramCtx,
    );
    await reply(
      chatId,
      result.subtask.status === 'AWAITING_APPROVAL'
        ? 'Sent for the MD to approve.'
        : 'Marked completed.',
    );
  } catch (error) {
    await reply(chatId, messageOf(error));
  }
}

async function askForProblem(
  chatId: string,
  user: LinkedUser,
  subtaskId: string,
  now: Date,
): Promise<void> {
  await remember(chatId, user.id, subtaskId, 'PROBLEM', null, now);
  await reply(
    chatId,
    'What is the problem? Describe it in at least 20 characters so the MD can act on it.',
  );
}

async function raiseFromChat(
  chatId: string,
  user: LinkedUser,
  subtaskId: string,
  description: string,
): Promise<void> {
  try {
    await changeStatus(
      subtaskId,
      { action: 'PROBLEM', note: description, severity: 'MEDIUM' },
      { id: user.id, role: user.role },
      telegramCtx,
    );
    await prisma.telegramPending.deleteMany({ where: { chatId } });
    await reply(chatId, 'Problem reported. The MD has been told.');
  } catch (error) {
    await reply(chatId, messageOf(error));
  }
}

async function askForDate(
  chatId: string,
  user: LinkedUser,
  subtaskId: string,
  now: Date,
): Promise<void> {
  if (await alreadyCommitted(chatId, subtaskId)) return;
  await remember(chatId, user.id, subtaskId, 'OTHER', null, now);
  await reply(chatId, 'Send the date as DD/MM, for example 12/10.');
}

async function proposeCommitment(
  chatId: string,
  user: LinkedUser,
  subtaskId: string,
  deadline: string,
  now: Date,
): Promise<void> {
  if (await alreadyCommitted(chatId, subtaskId)) return;

  const subtask = await prisma.subtask.findUnique({
    where: { id: subtaskId },
    select: {
      assigneeId: true,
      department: { select: { name: true } },
      job: { select: { jobCode: true } },
    },
  });
  if (!subtask || subtask.assigneeId !== user.id) {
    await reply(chatId, 'Only the person who holds this task can commit its date.');
    return;
  }

  let formatted: string;
  try {
    formatted = formatCommitment(deadline);
  } catch {
    await reply(chatId, 'That is not a valid date. Send it as DD/MM, for example 12/10.');
    return;
  }

  await remember(chatId, user.id, subtaskId, 'CONFIRM', deadline, now);
  await reply(
    chatId,
    `Commit ${formatted} as the finish date for ${subtask.department.name} on ${subtask.job.jobCode}? You cannot change it afterwards.`,
    [
      [
        { text: 'Confirm', callback_data: `yes:${subtaskId}` },
        { text: 'Cancel', callback_data: `no:${subtaskId}` },
      ],
    ],
  );
}

async function confirmCommitment(
  chatId: string,
  user: LinkedUser,
  subtaskId: string,
  now: Date,
): Promise<void> {
  const pending = await prisma.telegramPending.findUnique({ where: { chatId } });
  if (
    !pending ||
    pending.userId !== user.id ||
    pending.kind !== 'CONFIRM' ||
    pending.subtaskId !== subtaskId ||
    !pending.deadline ||
    pending.expiresAt.getTime() <= now.getTime()
  ) {
    await reply(chatId, 'That confirmation has expired. Choose the date again.');
    return;
  }

  try {
    await commitDeadline(
      subtaskId,
      { deadline: pending.deadline },
      { id: user.id, role: user.role },
      telegramCtx,
    );
    await prisma.telegramPending.deleteMany({ where: { chatId } });
    await reply(
      chatId,
      `Committed. Finish by ${formatCommitment(pending.deadline)}. You cannot change this date yourself.`,
    );
  } catch (error) {
    await reply(chatId, messageOf(error));
  }
}

async function alreadyCommitted(chatId: string, subtaskId: string): Promise<boolean> {
  const subtask = await prisma.subtask.findUnique({
    where: { id: subtaskId },
    select: { deadline: true },
  });
  if (!subtask?.deadline) return false;
  await reply(chatId, ALREADY_COMMITTED);
  return true;
}

async function remember(
  chatId: string,
  userId: string,
  subtaskId: string,
  kind: string,
  deadline: string | null,
  now: Date,
): Promise<void> {
  const expiresAt = new Date(now.getTime() + PENDING_TTL_MS);
  await prisma.telegramPending.upsert({
    where: { chatId },
    create: { chatId, userId, subtaskId, kind, deadline, expiresAt },
    update: { userId, subtaskId, kind, deadline, expiresAt },
  });
}

function messageOf(error: unknown): string {
  if (error instanceof AppError) return error.message;
  return 'That could not be done. Open the task in JTAS.';
}
