import { createHash } from 'node:crypto';
import webpush from 'web-push';
import { setTimeout as delay } from 'node:timers/promises';
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from 'vitest';
import { GET, POST, DELETE, PATCH } from '@/app/api/push/subscriptions/route';
import { POST as testPush } from '@/app/api/push/test/route';
import { ACCESS_COOKIE, REFRESH_COOKIE } from '@/lib/auth/cookies';
import { signAccessToken, signRefreshToken } from '@/lib/auth/jwt';
import {
  enqueue,
  listNotifications,
  scheduleForSubtask,
  cancelForSubtask,
} from '@/lib/notifications/notification-service';
import { dispatchDue } from '@/lib/notifications/sweeper';
import { useCapturingMail, restoreMail, failNextSends } from './helpers/mail';
import { ProviderQuotaError } from '@/lib/notifications/channels';
import { pushChannel } from '@/lib/notifications/channels/push';
import { revokeFamily } from '@/lib/services/auth/tokens';
import {
  createTestUser,
  createTestDepartment,
  createTestSubtask,
  resetAuthTables,
  testDb,
} from './helpers/db';

vi.mock('node:timers/promises', () => ({ setTimeout: vi.fn().mockResolvedValue(undefined) }));

const jar = vi.hoisted(() => new Map<string, string>());
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { value: jar.get(name) } : undefined),
  }),
}));
const input = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/test-device',
  keys: {
    p256dh: Buffer.alloc(65, 1).toString('base64url'),
    auth: Buffer.alloc(16, 2).toString('base64url'),
  },
  locale: 'ta',
};
let user: Awaited<ReturnType<typeof createTestUser>>;
let family: string;
let send: MockInstance<typeof webpush.sendNotification>;
const origin = 'http://localhost:3000';
function request(method = 'POST', body: unknown = input, from = origin) {
  return new Request(`${origin}/api/push/subscriptions`, {
    method,
    headers: { origin: from, 'content-type': 'application/json' },
    ...(method === 'GET' ? {} : { body: JSON.stringify(body) }),
  });
}
async function signIn(person = user) {
  family = crypto.randomUUID();
  await testDb.refreshToken.create({
    data: {
      userId: person.id,
      familyId: family,
      tokenHash: crypto.randomUUID(),
      expiresAt: new Date(Date.now() + 86_400_000),
    },
  });
  jar.set(
    ACCESS_COOKIE,
    await signAccessToken({
      sub: person.id,
      role: person.role,
      departmentId: person.departmentId,
      mustChangePassword: false,
    }),
  );
  jar.set(
    REFRESH_COOKIE,
    await signRefreshToken({ sub: person.id, familyId: family, jti: crypto.randomUUID() }, 86400),
  );
}
beforeEach(async () => {
  await resetAuthTables();
  vi.mocked(delay).mockReset().mockResolvedValue(undefined);
  jar.clear();
  useCapturingMail();
  user = await createTestUser({ mustChangePassword: false });
  await signIn();
  vi.stubEnv('APP_BASE_URL', origin);
  vi.stubEnv('VAPID_PUBLIC_KEY', 'test-public');
  vi.stubEnv('VAPID_PRIVATE_KEY', 'test-private');
  vi.stubEnv('VAPID_SUBJECT', 'mailto:admin@example.test');
  send = vi
    .spyOn(webpush, 'sendNotification')
    .mockResolvedValue({ statusCode: 201, headers: {}, body: '' });
});
afterEach(() => {
  restoreMail();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
afterAll(async () => {
  await resetAuthTables();
  await testDb.$disconnect();
});

async function queued() {
  await enqueue(testDb, {
    type: 'SUBTASK_ASSIGNED',
    userIds: [user.id],
    entityType: 'SUBTASK',
    entityId: 'task-1',
    subject: 'Subject',
    body: 'Body',
    dedupeKeyFor: (id) => `assigned:${id}`,
  });
  const row = await testDb.notification.findFirstOrThrow({ where: { channel: 'PUSH' } });
  return {
    id: row.id,
    type: row.type,
    entityType: row.entityType,
    entityId: row.entityId,
    subject: row.subject,
    body: row.body,
  };
}

describe('push subscription API', () => {
  it('requires authentication and same-origin writes', async () => {
    expect((await POST(request('POST', input, 'https://evil.example'))).status).toBe(403);
    jar.clear();
    expect((await GET(request('GET'))).status).toBe(401);
  });
  it('saves a device for the current session and never exposes its private keys', async () => {
    expect((await POST(request())).status).toBe(204);
    const stored = await testDb.pushSubscription.findUniqueOrThrow({
      where: { endpoint: input.endpoint },
    });
    expect(stored).toMatchObject({ userId: user.id, sessionFamilyId: family, locale: 'ta' });
    const response = await GET(
      new Request(
        `${origin}/api/push/subscriptions?endpoint=${encodeURIComponent(input.endpoint)}`,
      ),
    );
    expect(await response.json()).toEqual({
      publicKey: 'test-public',
      endpointHashes: [createHash('sha256').update(input.endpoint).digest('hex')],
    });
  });
  it('rejects internal destinations, malformed keys, and demo accounts', async () => {
    expect(
      (await POST(request('POST', { ...input, endpoint: 'https://169.254.169.254/secrets' })))
        .status,
    ).toBe(400);
    expect(
      (await POST(request('POST', { ...input, keys: { ...input.keys, auth: 'short' } }))).status,
    ).toBe(400);
    await testDb.user.update({ where: { id: user.id }, data: { isDemo: true } });
    expect((await POST(request())).status).toBe(403);
  });
  it('scopes disabling and test sends to the caller', async () => {
    await POST(request());
    const other = await createTestUser({ mustChangePassword: false });
    await signIn(other);
    await DELETE(request('DELETE', { endpoint: input.endpoint }));
    expect(await testDb.pushSubscription.count()).toBe(1);
    expect((await testPush(request('POST', { endpoint: input.endpoint }))).status).toBe(409);
    expect(send).not.toHaveBeenCalled();
  });
  it('changes language only for a device already owned by this session', async () => {
    await POST(request());
    expect((await PATCH(request('PATCH', { endpoint: input.endpoint, locale: 'hi' }))).status).toBe(
      204,
    );
    expect((await testDb.pushSubscription.findFirstOrThrow()).locale).toBe('hi');
    const other = await createTestUser({ mustChangePassword: false });
    await signIn(other);
    await PATCH(request('PATCH', { endpoint: input.endpoint, locale: 'en' }));
    expect((await testDb.pushSubscription.findFirstOrThrow()).locale).toBe('hi');
  });
  it('removes this session’s subscriptions on sign-out', async () => {
    await POST(request());
    await revokeFamily(family, user.id, { ipAddress: '127.0.0.1' }, 'LOGOUT');
    expect(await testDb.pushSubscription.count()).toBe(0);
  });
  it('waits on the server before sending a background test', async () => {
    await POST(request());
    let release!: () => void;
    vi.mocked(delay).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const pending = testPush(request('POST', { endpoint: input.endpoint, delaySeconds: 15 }));
    await vi.waitFor(() => expect(delay).toHaveBeenCalledWith(15000));
    expect(send).not.toHaveBeenCalled();
    release();
    expect((await pending).status).toBe(200);
    expect(send).toHaveBeenCalledTimes(1);
  });
  it('cancels a delayed test when notifications are disabled while waiting', async () => {
    await POST(request());
    let release!: () => void;
    vi.mocked(delay).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const pending = testPush(request('POST', { endpoint: input.endpoint, delaySeconds: 15 }));
    await vi.waitFor(() => expect(delay).toHaveBeenCalledWith(15000));
    await DELETE(request('DELETE', { endpoint: input.endpoint }));
    release();
    expect((await pending).status).toBe(409);
    expect(send).not.toHaveBeenCalled();
  });
  it('rejects unbounded background test delays', async () => {
    await POST(request());
    expect(
      (await testPush(request('POST', { endpoint: input.endpoint, delaySeconds: 3600 }))).status,
    ).toBe(400);
    expect(send).not.toHaveBeenCalled();
  });
  it('sends a Tamil test and removes expired endpoints', async () => {
    await POST(request());
    expect((await testPush(request('POST', { endpoint: input.endpoint }))).status).toBe(200);
    expect(JSON.parse(send.mock.calls[0][1] as string).title).toContain('சோதனை');
    expect(send.mock.calls[0][2]).toMatchObject({ urgency: 'high', TTL: 300 });
    send.mockRejectedValueOnce({ statusCode: 410 });
    expect((await testPush(request('POST', { endpoint: input.endpoint }))).status).toBe(409);
    expect(await testDb.pushSubscription.count()).toBe(0);
  });
});

describe('queued push delivery', () => {
  it('dispatches a real workflow notification through the worker queue', async () => {
    await POST(request());
    await testDb.setting.upsert({
      where: { key: 'suppress_reminders_outside_hours' },
      create: { key: 'suppress_reminders_outside_hours', value: false },
      update: { value: false },
    });
    const department = await createTestDepartment();
    const task = await createTestSubtask({ assigneeId: user.id, departmentId: department.id });
    await scheduleForSubtask(testDb, {
      id: task.id,
      assigneeId: user.id,
      deadline: null,
      reminderLeadMinutes: 60,
    });
    const result = await dispatchDue();
    expect(result.dispatched).toBe(2);
    expect(send).toHaveBeenCalledTimes(1);
    expect(JSON.parse(send.mock.calls[0][1] as string).url).toBe(`/tasks/${task.id}`);
    expect(send.mock.calls[0][2]).toMatchObject({ urgency: 'high', TTL: 86400 });
    expect((await listNotifications(user.id)).unreadCount).toBe(1);
  });
  it('delivers push even when the email provider has exhausted its quota', async () => {
    await POST(request());
    await testDb.setting.upsert({
      where: { key: 'suppress_reminders_outside_hours' },
      create: { key: 'suppress_reminders_outside_hours', value: false },
      update: { value: false },
    });
    const department = await createTestDepartment();
    const task = await createTestSubtask({ assigneeId: user.id, departmentId: department.id });
    await scheduleForSubtask(testDb, {
      id: task.id,
      assigneeId: user.id,
      deadline: null,
      reminderLeadMinutes: 60,
    });
    await testDb.notification.updateMany({
      where: { channel: 'EMAIL' },
      data: { scheduledFor: new Date(Date.now() - 2000) },
    });
    await testDb.notification.updateMany({
      where: { channel: 'PUSH' },
      data: { scheduledFor: new Date(Date.now() - 1000) },
    });
    failNextSends(1, () => new ProviderQuotaError('Daily provider quota exhausted'));
    const result = await dispatchDue();
    expect(result.quotaHeld).toBe(1);
    expect(result.dispatched).toBe(1);
    expect(send).toHaveBeenCalledTimes(1);
    expect(await testDb.notification.findFirst({ where: { channel: 'EMAIL' } })).toMatchObject({
      status: 'PENDING',
      attemptCount: 0,
    });
  });
  it('cancels queued push reminders along with their email copies', async () => {
    await POST(request());
    const department = await createTestDepartment();
    const task = await createTestSubtask({ assigneeId: user.id, departmentId: department.id });
    await scheduleForSubtask(testDb, {
      id: task.id,
      assigneeId: user.id,
      deadline: new Date(Date.now() + 86400000),
      reminderLeadMinutes: 60,
    });
    expect(await testDb.notification.count({ where: { channel: 'PUSH' } })).toBe(2);
    await cancelForSubtask(testDb, task.id);
    expect(
      await testDb.notification.count({ where: { entityId: task.id, status: 'PENDING' } }),
    ).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });
  it('mirrors once and keeps delivery copies out of the inbox and badge', async () => {
    await POST(request());
    await queued();
    await queued();
    expect(await testDb.notification.count({ where: { channel: 'PUSH' } })).toBe(1);
    await testDb.notification.updateMany({ data: { status: 'SENT', sentAt: new Date() } });
    const inbox = await listNotifications(user.id);
    expect(inbox.data).toHaveLength(1);
    expect(inbox.unreadCount).toBe(1);
  });
  it('retries only the failed device, and includes a task link', async () => {
    await POST(request());
    await POST(request('POST', { ...input, endpoint: `${input.endpoint}-2`, locale: 'hi' }));
    const notification = await queued();
    send
      .mockResolvedValueOnce({ statusCode: 201, headers: {}, body: '' })
      .mockRejectedValueOnce({ statusCode: 503 });
    await expect(pushChannel.send(notification, user)).rejects.toThrow('temporarily unavailable');
    expect(await testDb.pushDelivery.count()).toBe(1);
    await pushChannel.send(notification, user);
    expect(send).toHaveBeenCalledTimes(3);
    expect(await testDb.pushDelivery.count()).toBe(2);
    expect(JSON.parse(send.mock.calls[2][1] as string)).toMatchObject({
      url: '/tasks/task-1',
      tag: notification.id,
    });
    // Database reads have no guaranteed order. Follow the device that failed,
    // rather than assuming the Hindi subscription was returned second.
    const failedEndpoint = (send.mock.calls[1][0] as { endpoint: string }).endpoint;
    expect((send.mock.calls[2][0] as { endpoint: string }).endpoint).toBe(failedEndpoint);
    const retry = JSON.parse(send.mock.calls[2][1] as string);
    expect(retry.lang).toBe(failedEndpoint.endsWith('-2') ? 'hi' : 'ta');
    expect(retry.title).toContain(failedEndpoint.endsWith('-2') ? 'नया कार्य' : 'புதிய பணி');
  });
  it('does not send to an expired session and cleans up the subscription', async () => {
    await POST(request());
    const notification = await queued();
    await testDb.refreshToken.updateMany({ data: { expiresAt: new Date(0) } });
    await pushChannel.send(notification, user);
    expect(send).not.toHaveBeenCalled();
    expect(await testDb.pushSubscription.count()).toBe(0);
  });
  it('deletes a gone endpoint without retrying it forever', async () => {
    await POST(request());
    const notification = await queued();
    send.mockRejectedValueOnce({ statusCode: 410 });
    await pushChannel.send(notification, user);
    expect(await testDb.pushSubscription.count()).toBe(0);
  });
});
