import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { reminderKey } from '@/lib/notifications/dedupe';
import { enqueue } from '@/lib/notifications/notification-service';
import { dispatchDue } from '@/lib/notifications/sweeper';
import { changeStatus } from '@/lib/services/subtasks';
import { setTelegramTransport } from '@/lib/telegram/api';
import { handleTelegramUpdate } from '@/lib/telegram/handle-update';
import { issueLinkCode } from '@/lib/telegram/link';

import {
  createTestDepartment,
  createTestSubtask,
  createTestUser,
  resetAuthTables,
  testDb,
} from './helpers/db';
import { restoreMail, useCapturingMail } from './helpers/mail';

const webCtx = { ipAddress: '203.0.113.7' };

type Sent = { method: string; body: Record<string, unknown> };

let sent: Sent[];

function texts(): string[] {
  return sent.filter((call) => call.method === 'sendMessage').map((call) => String(call.body.text));
}

beforeEach(async () => {
  await resetAuthTables();
  useCapturingMail();
  sent = [];
  setTelegramTransport(async (method, body) => {
    sent.push({ method, body });
    return { message_id: sent.length };
  });
  await testDb.setting.upsert({
    where: { key: 'suppress_reminders_outside_hours' },
    create: { key: 'suppress_reminders_outside_hours', value: false },
    update: { value: false },
  });
});

afterEach(() => {
  setTelegramTransport(null);
  restoreMail();
});

afterAll(async () => {
  await resetAuthTables();
  await testDb.$disconnect();
});

async function memberWithTask(
  options: { deadline?: Date | null; status?: 'PENDING' | 'IN_PROGRESS' } = {},
) {
  const department = await createTestDepartment();
  const member = await createTestUser({ departmentId: department.id });
  const subtask = await createTestSubtask({
    assigneeId: member.id,
    departmentId: department.id,
    createdById: member.id,
    status: options.status ?? 'IN_PROGRESS',
    deadline:
      options.deadline === undefined
        ? new Date('2026-12-01T12:30:00.000Z')
        : (options.deadline ?? undefined),
  });
  if (options.deadline === null) {
    await testDb.subtask.update({
      where: { id: subtask.id },
      data: {
        deadline: null,
        deadlineOrigin: null,
        commitmentDueAt: new Date(Date.now() + 86_400_000),
      },
    });
  }
  await testDb.job.update({
    where: { id: subtask.jobId },
    data: { partNumber: 'VB-100', overallDeadline: new Date('2027-06-30T12:30:00.000Z') },
  });
  return { member, subtask };
}

async function link(userId: string, chatId: string) {
  const issued = await issueLinkCode(userId);
  await handleTelegramUpdate({
    message: { text: `/start ${issued.code}`, chat: { id: Number(chatId), type: 'private' } },
  });
  return issued.code;
}

describe('telegram linking', () => {
  it('links a valid code, refuses a used one, and ignores a wrong one', async () => {
    const department = await createTestDepartment();
    const member = await createTestUser({ departmentId: department.id, name: 'Meena' });

    const code = await link(member.id, '1001');
    const linked = await testDb.user.findUnique({ where: { id: member.id } });
    expect(linked?.telegramChatId).toBe('1001');
    expect(texts().some((text) => text.includes('Linked as Meena'))).toBe(true);

    sent = [];
    await handleTelegramUpdate({
      message: { text: `/start ${code}`, chat: { id: 1002, type: 'private' } },
    });
    expect(texts()[0]).toMatch(/already been used/i);
    const still = await testDb.user.findUnique({ where: { id: member.id } });
    expect(still?.telegramChatId).toBe('1001');
    expect(await testDb.user.findFirst({ where: { telegramChatId: '1002' } })).toBeNull();

    sent = [];
    await handleTelegramUpdate({
      message: { text: '/start NOTACODE', chat: { id: 1003, type: 'private' } },
    });
    expect(texts()).toEqual([]);
    expect(await testDb.user.findFirst({ where: { telegramChatId: '1003' } })).toBeNull();
  });
});

describe('telegram actions', () => {
  it('completes a task with the same state and audit as the website, marked as Telegram', async () => {
    const web = await memberWithTask();
    const phone = await memberWithTask();
    await link(phone.member.id, '2001');
    sent = [];

    await changeStatus(
      web.subtask.id,
      { action: 'COMPLETE' },
      { id: web.member.id, role: 'MEMBER' },
      webCtx,
    );
    await handleTelegramUpdate({
      callback_query: {
        id: 'cb-1',
        data: `done:${phone.subtask.id}`,
        message: { chat: { id: 2001, type: 'private' } },
      },
    });

    const [webRow, phoneRow] = await Promise.all([
      testDb.subtask.findUnique({ where: { id: web.subtask.id } }),
      testDb.subtask.findUnique({ where: { id: phone.subtask.id } }),
    ]);
    expect(phoneRow?.status).toBe('COMPLETED');
    expect(phoneRow?.status).toBe(webRow?.status);
    expect(phoneRow?.completionNote).toBe(webRow?.completionNote);
    expect(phoneRow?.completedAt).not.toBeNull();

    const shape = async (subtaskId: string, jobId: string) => {
      const rows = await testDb.auditLog.findMany({
        where: { OR: [{ entityId: subtaskId }, { entityId: jobId }] },
        orderBy: [{ action: 'asc' }, { entityType: 'asc' }],
      });
      return rows.map((row) => ({
        action: row.action,
        entityType: row.entityType,
        before: row.before,
        after: row.after,
        source: row.source,
      }));
    };

    const webAudit = await shape(web.subtask.id, web.subtask.jobId);
    const phoneAudit = await shape(phone.subtask.id, phone.subtask.jobId);
    expect(phoneAudit.map(({ source: _source, ...row }) => row)).toEqual(
      webAudit.map(({ source: _source, ...row }) => row),
    );
    expect(phoneAudit.length).toBeGreaterThan(0);
    expect(phoneAudit.every((row) => row.source === 'TELEGRAM')).toBe(true);
    expect(webAudit.every((row) => row.source === 'WEB')).toBe(true);
    expect(texts()).toContain('Marked completed.');
  });

  it('commits once from a button and refuses a second attempt', async () => {
    const { member, subtask } = await memberWithTask({ deadline: null, status: 'PENDING' });
    await link(member.id, '3001');
    sent = [];

    await handleTelegramUpdate({
      callback_query: {
        id: 'cb-2',
        data: `d2:${subtask.id}`,
        message: { chat: { id: 3001, type: 'private' } },
      },
    });
    expect(texts().at(-1)).toMatch(/You cannot change it afterwards/);
    expect(await testDb.subtask.findUnique({ where: { id: subtask.id } })).toMatchObject({
      deadline: null,
    });

    await handleTelegramUpdate({
      callback_query: {
        id: 'cb-3',
        data: `yes:${subtask.id}`,
        message: { chat: { id: 3001, type: 'private' } },
      },
    });

    const committed = await testDb.subtask.findUnique({ where: { id: subtask.id } });
    expect(committed?.deadline).not.toBeNull();
    expect(committed?.deadlineOrigin).toBe('DEPARTMENT');
    const audit = await testDb.auditLog.findFirst({
      where: { entityId: subtask.id, action: 'SUBTASK_DEADLINE_CHANGED' },
    });
    expect(audit?.source).toBe('TELEGRAM');

    const deadline = committed?.deadline?.toISOString();
    sent = [];
    await handleTelegramUpdate({
      callback_query: {
        id: 'cb-4',
        data: `d2:${subtask.id}`,
        message: { chat: { id: 3001, type: 'private' } },
      },
    });
    expect(texts()[0]).toMatch(/already committed/i);
    const again = await testDb.subtask.findUnique({ where: { id: subtask.id } });
    expect(again?.deadline?.toISOString()).toBe(deadline);
  });

  it('keeps the 20-character problem minimum', async () => {
    const { member, subtask } = await memberWithTask();
    await link(member.id, '5001');
    sent = [];

    await handleTelegramUpdate({
      callback_query: {
        id: 'cb-prob',
        data: `prob:${subtask.id}`,
        message: { chat: { id: 5001, type: 'private' } },
      },
    });
    await handleTelegramUpdate({
      message: { text: 'too short', chat: { id: 5001, type: 'private' } },
    });

    expect(texts().at(-1)).toMatch(/at least 20 characters/);
    const row = await testDb.subtask.findUnique({ where: { id: subtask.id } });
    expect(row?.status).toBe('IN_PROGRESS');
  });
});

describe('telegram delivery', () => {
  it('sends email only when nobody is linked, and ignores an unknown chat', async () => {
    const { member, subtask } = await memberWithTask();
    const deadline = new Date('2026-12-01T12:30:00.000Z');

    await enqueue(testDb, {
      type: 'DEADLINE_REMINDER',
      userIds: [member.id],
      entityType: 'SUBTASK',
      entityId: subtask.id,
      subject: '',
      body: '',
      dedupeKeyFor: () => reminderKey(subtask.id, deadline),
      scheduledFor: new Date(),
    });

    const rows = await testDb.notification.findMany({ where: { userId: member.id } });
    expect(rows.map((row) => row.channel).sort()).toEqual(['EMAIL']);

    await expect(dispatchDue(new Date())).resolves.toMatchObject({ failed: 0 });

    sent = [];
    await handleTelegramUpdate({
      message: { text: 'hello', chat: { id: 999001, type: 'private' } },
    });
    expect(texts()).toEqual([]);
  });

  it('also queues Telegram when a chat is linked', async () => {
    const { member, subtask } = await memberWithTask();
    await testDb.user.update({ where: { id: member.id }, data: { telegramChatId: '4001' } });
    await testDb.job.update({ where: { id: subtask.jobId }, data: { partNumber: 'VB-100' } });

    await enqueue(testDb, {
      type: 'DEADLINE_REMINDER',
      userIds: [member.id],
      entityType: 'SUBTASK',
      entityId: subtask.id,
      subject: '',
      body: '',
      dedupeKeyFor: () => reminderKey(subtask.id, subtask.deadline!),
      scheduledFor: new Date(),
    });

    const channels = (
      await testDb.notification.findMany({
        where: { userId: member.id },
        select: { channel: true },
      })
    )
      .map((row) => row.channel)
      .sort();
    expect(channels).toEqual(['EMAIL', 'TELEGRAM']);

    await dispatchDue(new Date());
    const body = texts()[0] ?? '';
    const job = await testDb.job.findUnique({ where: { id: subtask.jobId } });
    expect(body.startsWith(`${job?.jobCode} · VB-100`)).toBe(true);
    expect(body.length).toBeLessThanOrEqual(300);
    const keyboard = sent.find((call) => call.method === 'sendMessage')?.body.reply_markup as {
      inline_keyboard: { text: string }[][];
    };
    const labels = keyboard.inline_keyboard.flat().map((button) => button.text);
    expect(labels).toEqual(['Mark completed', 'Report problem']);
  });
});
