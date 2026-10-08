/**
 * Inbound Telegram updates.
 *
 * Buttons and typed replies both call the same services the web app calls.
 * A chat that is not linked to a user gets no message back.
 */
import type { ProblemSeverity, Role } from '@prisma/client';

import { prisma } from '@/lib/db/prisma';
import { AppError } from '@/lib/errors';
import { PermanentChannelError } from '@/lib/notifications/channels/types';
import { ingestAttachment } from '@/lib/services/attachment-service';
import { changeStatus, commitDeadline } from '@/lib/services/subtasks';
import { moduleLogger } from '@/lib/utils/logger';
import { formatIST } from '@/lib/utils/time';

import { downloadTelegramFile, sendTelegramMessage, telegramApi } from './api';
import { commitmentChoice, formatCommitment, parseDayMonth } from './dates';
import { rememberFocus } from './focus';
import { consumeLinkCode } from './link';
import { jobTimelineMessage } from './text';
import { loadJobTimeline } from './timeline';

const log = moduleLogger('telegram');

const PENDING_TTL_MS = 15 * 60 * 1000;

const ALREADY_COMMITTED =
  'This date is already committed. You cannot move it. Ask the MD for more time.';

const HELP = [
  '/tasks — your open work. Tap one to make it current.',
  '/job JGE-2026-0003 — the timeline for that job.',
  '/startwork — start the current task.',
  '/done — mark the current task completed.',
  '/problem — report a problem. You choose how serious, then describe it.',
  '/file — then send a photo or a PDF.',
  'The buttons on a JTAS message do the same thing.',
].join('\n');

const NO_TASK = 'No task is selected.';

const DATE_STAMP = 'd MMM yyyy, h:mm a';

interface Command {
  name: string;
  argument: string | null;
}

/**
 * A missing token fails the same way on every retry, so Telegram must not
 * keep the update. A network or Telegram outage is worth another attempt.
 */
export function telegramReplyShouldRetry(error: unknown): boolean {
  return !(error instanceof PermanentChannelError);
}

export interface TelegramUpdate {
  update_id?: number;
  message?: {
    text?: string;
    chat: { id: number; type?: string };
    photo?: { file_id: string; file_size?: number }[];
    document?: { file_id: string; file_name?: string; mime_type?: string; file_size?: number };
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

    const file = incomingFile(message);
    if (file) {
      await receiveFile(chatId, user, file, now);
      return;
    }

    const command = text ? parseCommand(text) : null;
    if (command) {
      await handleCommand(chatId, user, command, now);
      return;
    }

    if (text) await handleText(chatId, user, text, now);
  } catch (error) {
    const retry = telegramReplyShouldRetry(error);
    log.error(
      { err: error, updateId: update.update_id ?? null, retry },
      retry
        ? 'telegram reply failed; Telegram will retry'
        : 'telegram reply was not sent; a configuration error is not retried',
    );
    if (retry) throw error;
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
  if (action === 'start') {
    await startWork(chatId, user, subtaskId);
    return;
  }
  if (action === 'prob') {
    await askForSeverity(chatId, user, subtaskId, now);
    return;
  }
  if (action === 'sl' || action === 'sm' || action === 'sh') {
    const severity = action === 'sl' ? 'LOW' : action === 'sm' ? 'MEDIUM' : 'HIGH';
    await askForProblemText(chatId, user, subtaskId, severity, now);
    return;
  }
  if (action === 'ok') {
    await approveCompletion(chatId, user, subtaskId);
    return;
  }
  if (action === 'back') {
    await askForRejection(chatId, user, subtaskId, now);
    return;
  }
  if (action === 'use') {
    await selectTask(chatId, user, subtaskId, now);
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
    await rememberFocus(chatId, user.id, subtaskId, { now, force: true });
    await reply(chatId, 'Cancelled. Nothing was saved.');
    return;
  }
  if (action === 'file') {
    await expectFile(chatId, user, subtaskId, now);
  }
}

function parseCommand(text: string): Command | null {
  const match = /^\/([a-z]+)(?:@\S+)?(?:\s+([\s\S]+))?$/i.exec(text.trim());
  if (!match?.[1]) return null;
  const argument = match[2]?.trim();
  return { name: match[1].toLowerCase(), argument: argument ? argument : null };
}

async function handleCommand(
  chatId: string,
  user: LinkedUser,
  command: Command,
  now: Date,
): Promise<void> {
  if (command.name === 'help') {
    await reply(chatId, HELP);
    return;
  }
  if (command.name === 'tasks') {
    await listTasks(chatId, user, null);
    return;
  }
  if (command.name === 'job') {
    await showJob(chatId, user, command.argument);
    return;
  }
  if (command.name === 'file') {
    const subtaskId = await requireTask(chatId, user, now);
    if (subtaskId) await expectFile(chatId, user, subtaskId, now);
    return;
  }
  if (command.name === 'problem') {
    const subtaskId = await requireTask(chatId, user, now);
    if (subtaskId) await askForSeverity(chatId, user, subtaskId, now);
    return;
  }
  if (command.name === 'done') {
    const subtaskId = await requireTask(chatId, user, now);
    if (subtaskId) await markCompleted(chatId, user, subtaskId);
    return;
  }
  if (command.name === 'startwork') {
    const subtaskId = await requireTask(chatId, user, now);
    if (subtaskId) await startWork(chatId, user, subtaskId);
    return;
  }

  await reply(chatId, HELP);
}

async function handleText(
  chatId: string,
  user: LinkedUser,
  text: string,
  now: Date,
): Promise<void> {
  const pending = await prisma.telegramPending.findUnique({ where: { chatId } });
  if (!pending || pending.userId !== user.id) {
    await reply(chatId, `${NO_TASK}\n\n${HELP}`);
    return;
  }

  if (pending.kind !== 'FOCUS' && pending.expiresAt.getTime() <= now.getTime()) {
    await rememberFocus(chatId, user.id, pending.subtaskId, { now, force: true });
    await reply(chatId, 'That has expired. Send /help, or use the buttons on the task message.');
    return;
  }

  const severity = severityOf(pending.kind);
  if (severity) {
    await raiseFromChat(chatId, user, pending.subtaskId, text, severity);
    return;
  }

  if (pending.kind === 'SEVERITY' || pending.kind === 'PROBLEM') {
    await reply(chatId, 'Choose Low, Medium, or High.');
    return;
  }

  if (pending.kind === 'REJECT') {
    await rejectFromChat(chatId, user, pending.subtaskId, text);
    return;
  }

  if (pending.kind === 'FILE') {
    await reply(chatId, 'Send a photo or a PDF. Text on its own is not filed.');
    return;
  }

  if (pending.kind === 'OTHER') {
    const value = parseDayMonth(text, now);
    if (!value) {
      await reply(chatId, 'Send the date as DD/MM, for example 12/10.');
      return;
    }
    await proposeCommitment(chatId, user, pending.subtaskId, value, now);
    return;
  }

  await reply(chatId, HELP);
}

function severityOf(kind: string): ProblemSeverity | null {
  if (kind === 'PROBLEM_LOW') return 'LOW';
  if (kind === 'PROBLEM_MEDIUM') return 'MEDIUM';
  if (kind === 'PROBLEM_HIGH') return 'HIGH';
  return null;
}

async function markCompleted(chatId: string, user: LinkedUser, subtaskId: string): Promise<void> {
  try {
    const result = await changeStatus(
      subtaskId,
      { action: 'COMPLETE' },
      { id: user.id, role: user.role },
      telegramCtx,
    );
    await rememberFocus(chatId, user.id, subtaskId, { force: true });
    const finished =
      result.subtask.status === 'AWAITING_APPROVAL'
        ? 'Sent for the MD to approve. Attach the finished files if you have them.'
        : 'Marked completed. Attach the finished files, a photo, or a PDF.';
    await reply(chatId, finished, [
      [{ text: 'Attach a file', callback_data: `file:${subtaskId}` }],
    ]);
  } catch (error) {
    await reply(chatId, messageOf(error));
  }
}

async function startWork(chatId: string, user: LinkedUser, subtaskId: string): Promise<void> {
  try {
    await changeStatus(
      subtaskId,
      { action: 'START' },
      { id: user.id, role: user.role },
      telegramCtx,
    );
    await rememberFocus(chatId, user.id, subtaskId, { force: true });
    await reply(chatId, 'Started.');
  } catch (error) {
    await reply(chatId, messageOf(error));
  }
}

async function approveCompletion(
  chatId: string,
  user: LinkedUser,
  subtaskId: string,
): Promise<void> {
  try {
    await changeStatus(
      subtaskId,
      { action: 'APPROVE' },
      { id: user.id, role: user.role },
      telegramCtx,
    );
    await reply(chatId, 'Approved. It counts as done.');
  } catch (error) {
    await reply(chatId, messageOf(error));
  }
}

async function askForRejection(
  chatId: string,
  user: LinkedUser,
  subtaskId: string,
  now: Date,
): Promise<void> {
  await remember(chatId, user.id, subtaskId, 'REJECT', null, now);
  await reply(chatId, 'Say what still needs doing before this goes back.');
}

async function rejectFromChat(
  chatId: string,
  user: LinkedUser,
  subtaskId: string,
  note: string,
): Promise<void> {
  try {
    await changeStatus(
      subtaskId,
      { action: 'REJECT', note },
      { id: user.id, role: user.role },
      telegramCtx,
    );
    await rememberFocus(chatId, user.id, subtaskId, { force: true });
    await reply(chatId, 'Sent back. They can carry on.');
  } catch (error) {
    await reply(chatId, messageOf(error));
  }
}

async function askForSeverity(
  chatId: string,
  user: LinkedUser,
  subtaskId: string,
  now: Date,
): Promise<void> {
  await remember(chatId, user.id, subtaskId, 'SEVERITY', null, now);
  await reply(chatId, 'How serious is it?', [
    [
      { text: 'Low', callback_data: `sl:${subtaskId}` },
      { text: 'Medium', callback_data: `sm:${subtaskId}` },
      { text: 'High', callback_data: `sh:${subtaskId}` },
    ],
  ]);
}

async function askForProblemText(
  chatId: string,
  user: LinkedUser,
  subtaskId: string,
  severity: ProblemSeverity,
  now: Date,
): Promise<void> {
  await remember(chatId, user.id, subtaskId, `PROBLEM_${severity}`, null, now);
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
  severity: ProblemSeverity,
): Promise<void> {
  try {
    await changeStatus(
      subtaskId,
      { action: 'PROBLEM', note: description, severity },
      { id: user.id, role: user.role },
      telegramCtx,
    );
    await rememberFocus(chatId, user.id, subtaskId, { force: true });
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
    await rememberFocus(chatId, user.id, subtaskId, { now, force: true });
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

async function requireTask(chatId: string, user: LinkedUser, now: Date): Promise<string | null> {
  const pending = await prisma.telegramPending.findUnique({ where: { chatId } });
  if (!pending || pending.userId !== user.id) {
    await listTasks(chatId, user, NO_TASK);
    return null;
  }

  if (pending.kind !== 'FOCUS' && pending.expiresAt.getTime() <= now.getTime()) {
    await rememberFocus(chatId, user.id, pending.subtaskId, { now, force: true });
  }

  return pending.subtaskId;
}

async function selectTask(
  chatId: string,
  user: LinkedUser,
  subtaskId: string,
  now: Date,
): Promise<void> {
  const subtask = await prisma.subtask.findUnique({
    where: { id: subtaskId },
    select: {
      assigneeId: true,
      title: true,
      job: { select: { jobCode: true } },
    },
  });
  if (!subtask || subtask.assigneeId !== user.id) {
    await reply(chatId, 'That task is not yours.');
    return;
  }

  await rememberFocus(chatId, user.id, subtaskId, { now, force: true });
  await reply(chatId, `Current task: ${subtask.job.jobCode} — ${subtask.title}.`);
}

async function listTasks(chatId: string, user: LinkedUser, lead: string | null): Promise<void> {
  const tasks = await prisma.subtask.findMany({
    where: {
      assigneeId: user.id,
      status: { in: ['PENDING', 'IN_PROGRESS', 'BLOCKED', 'PROBLEM', 'AWAITING_APPROVAL'] },
      job: { status: { notIn: ['CANCELLED', 'ON_HOLD', 'DRAFT'] } },
    },
    orderBy: [{ deadline: 'asc' }],
    take: 10,
    select: {
      id: true,
      title: true,
      status: true,
      deadline: true,
      job: { select: { jobCode: true } },
    },
  });

  if (tasks.length === 0) {
    await reply(chatId, lead ? `${lead}\n\nYou have no open tasks.` : 'You have no open tasks.');
    return;
  }

  const lines = tasks.map((task, index) => {
    const when = task.deadline ? formatIST(task.deadline, DATE_STAMP) : 'not set yet';
    return `${index + 1}. ${task.job.jobCode} — ${task.title}\nFinish date: ${when}\nStatus: ${task.status.replace(/_/g, ' ').toLowerCase()}`;
  });

  const parts = [lead, 'Open work', ...lines, 'Tap one to make it current.'].filter(
    (part): part is string => Boolean(part),
  );
  await reply(
    chatId,
    parts.join('\n\n'),
    tasks.map((task) => [
      {
        text: buttonLabel(`${task.job.jobCode} · ${task.title}`),
        callback_data: `use:${task.id}`,
      },
    ]),
  );
}

async function showJob(chatId: string, user: LinkedUser, code: string | null): Promise<void> {
  if (!code) {
    await reply(chatId, 'Send /job and the job code, for example /job JGE-2026-0003.');
    return;
  }

  const job = await prisma.job.findFirst({
    where: { jobCode: { equals: code, mode: 'insensitive' } },
    select: { id: true, jobCode: true, title: true, partNumber: true, drawingNumber: true },
  });
  if (!job) {
    await reply(chatId, 'No job with that code.');
    return;
  }

  const seesAll = user.role === 'MD' || user.role === 'DEPUTY_MD';
  if (!seesAll) {
    const mine = await prisma.subtask.findFirst({
      where: { jobId: job.id, assigneeId: user.id },
      select: { id: true },
    });
    if (!mine) {
      await reply(chatId, 'That job is not on your list.');
      return;
    }
  }

  const timeline = await loadJobTimeline(job.id);
  if (!timeline) {
    await reply(chatId, 'No job with that code.');
    return;
  }

  await reply(
    chatId,
    jobTimelineMessage(
      {
        jobCode: job.jobCode,
        jobTitle: job.title,
        partNumber: job.partNumber,
        drawingNumber: job.drawingNumber,
      },
      timeline,
      user.id,
    ),
  );
}

function buttonLabel(text: string): string {
  return text.length <= 60 ? text : `${text.slice(0, 59)}…`;
}

/** Telegram's getFile stops at 20 MB. JTAS itself allows 25 MB from the website. */
const TELEGRAM_FILE_LIMIT = 20 * 1024 * 1024;

const TOO_LARGE = 'That file is too large. Upload it on the website.';

const WINDOW_EXPIRED =
  'That attachment window has expired. Tap Attach a file on the task message, then send the photo or PDF again.';

interface IncomingFile {
  fileId: string;
  fileName: string;
  contentType: string;
  fileSize?: number;
}

function incomingFile(message: TelegramUpdate['message']): IncomingFile | null {
  const photo = message?.photo?.at(-1);
  if (photo) {
    return {
      fileId: photo.file_id,
      fileName: 'photo.jpg',
      contentType: 'image/jpeg',
      fileSize: photo.file_size,
    };
  }

  const document = message?.document;
  if (!document) return null;

  const fileName = document.file_name?.split(/[/\\]/).pop() || 'file';
  return {
    fileId: document.file_id,
    fileName,
    contentType: document.mime_type?.split(';')[0]?.trim() || 'application/octet-stream',
    fileSize: document.file_size,
  };
}

async function expectFile(
  chatId: string,
  user: LinkedUser,
  subtaskId: string,
  now: Date,
): Promise<void> {
  const subtask = await loadOwnedSubtask(user, subtaskId);
  if (!subtask) {
    await reply(chatId, 'Only the person who holds this task can attach a file to it.');
    return;
  }

  await remember(chatId, user.id, subtaskId, 'FILE', null, now);
  await reply(
    chatId,
    `Send a photo or a PDF for ${subtask.job.jobCode}. It will be filed on ${subtask.title}. A photo from the camera arrives as a JPEG, which is accepted.`,
  );
}

async function receiveFile(
  chatId: string,
  user: LinkedUser,
  file: IncomingFile,
  now: Date,
): Promise<void> {
  const pending = await prisma.telegramPending.findUnique({ where: { chatId } });
  if (
    pending &&
    pending.userId === user.id &&
    pending.kind === 'FILE' &&
    pending.expiresAt.getTime() <= now.getTime()
  ) {
    await rememberFocus(chatId, user.id, pending.subtaskId, { now, force: true });
    await reply(chatId, WINDOW_EXPIRED);
    return;
  }

  if (!pending || pending.userId !== user.id || pending.kind !== 'FILE') {
    await reply(chatId, 'Tap Attach a file on the task message, then send the photo or PDF.');
    return;
  }

  const extension = file.fileName.split('.').pop()?.toLowerCase();
  if (extension === 'heic' || extension === 'heif') {
    await reply(
      chatId,
      'Send that as a photo, not as a file. Telegram delivers a camera photo as a JPEG, which this task can keep.',
    );
    return;
  }

  if (file.fileSize && file.fileSize > TELEGRAM_FILE_LIMIT) {
    await reply(chatId, TOO_LARGE);
    return;
  }

  const subtask = await loadOwnedSubtask(user, pending.subtaskId);
  if (!subtask) {
    await reply(chatId, 'Only the person who holds this task can attach a file to it.');
    return;
  }

  try {
    const bytes = await downloadTelegramFile(file.fileId);
    if (bytes.byteLength > TELEGRAM_FILE_LIMIT) {
      await reply(chatId, TOO_LARGE);
      return;
    }

    const row = await ingestAttachment(
      {
        jobId: subtask.jobId,
        subtaskId: subtask.id,
        fileName: file.fileName,
        contentType: file.contentType,
        bytes,
      },
      { id: user.id },
      telegramCtx,
    );
    await remember(chatId, user.id, subtask.id, 'FILE', null, now);
    await reply(
      chatId,
      `Filed ${row.fileName} on ${subtask.job.jobCode}. It is on the task for the MD. Send another, or you are done.`,
      [[{ text: 'Attach another file', callback_data: `file:${subtask.id}` }]],
    );
  } catch (error) {
    const told = fileFailure(error);
    if (told) {
      await reply(chatId, told);
      return;
    }
    throw error;
  }
}

async function loadOwnedSubtask(user: LinkedUser, subtaskId: string) {
  const subtask = await prisma.subtask.findUnique({
    where: { id: subtaskId },
    select: {
      id: true,
      jobId: true,
      assigneeId: true,
      title: true,
      job: { select: { jobCode: true } },
    },
  });
  if (!subtask) return null;
  const holdsIt = user.id === subtask.assigneeId || user.role === 'MD' || user.role === 'DEPUTY_MD';
  return holdsIt ? subtask : null;
}

function fileFailure(error: unknown): string | null {
  if (error instanceof AppError) return error.message;
  if (error instanceof PermanentChannelError && /too big/i.test(error.message)) {
    return TOO_LARGE;
  }
  return null;
}

function messageOf(error: unknown): string {
  if (error instanceof AppError) return error.message;
  return 'That could not be done. Open the task in JTAS.';
}
