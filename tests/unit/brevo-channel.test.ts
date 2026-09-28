/**
 * The Brevo adapter against a mocked `fetch`.
 *
 * The mapping from a provider's response to one of the three errors the
 * sweeper acts on is the entire adapter, and getting it wrong is expensive in
 * both directions: a misread 5xx drops mail that would have gone on the next
 * try, and a misread quota refusal burns five attempts against a limit that
 * cannot move until midnight — then fails the row, so the message never goes
 * at all.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  brevoChannel,
  BREVO_ENDPOINT,
  classifyBrevoResponse,
  parseSender,
} from '@/lib/notifications/channels/brevo';
import {
  PermanentChannelError,
  ProviderQuotaError,
  TransientChannelError,
  isRetryable,
} from '@/lib/notifications/channels/types';
import * as settings from '@/lib/services/settings';
import { resetEnvCache } from '@/lib/utils/env';

const NOTIFICATION = {
  id: 'notif-1',
  type: 'OVERDUE_MEMBER',
  subject: 'Please complete the work',
  body: 'Machining is 2 hours past its deadline.',
  html: '<p>Machining is 2 hours past its deadline.</p>',
  entityType: 'SUBTASK',
  entityId: 'subtask-1',
};

const RECIPIENT = {
  id: 'user-1',
  name: 'Production Member',
  email: 'member@example.com',
  phone: null,
};

/** A minimal stand-in for the parts of Response the adapter touches. */
function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

let fetchMock: ReturnType<typeof vi.fn>;

/*
 * `send` validates the whole environment through `env()`, so the unrelated
 * required keys need placeholder values here. They are never used: nothing in
 * this file opens a database or signs a token.
 */
const REQUIRED_BY_ENV_SCHEMA = {
  DATABASE_URL: 'postgresql://unused:unused@localhost:5432/unused',
  JWT_SECRET: 'unit-test-placeholder-secret-at-least-32-chars',
  REFRESH_SECRET: 'unit-test-placeholder-refresh-at-least-32-chars',
};

beforeEach(() => {
  Object.assign(process.env, REQUIRED_BY_ENV_SCHEMA);
  process.env.BREVO_API_KEY = 'test-key-not-a-real-secret';
  process.env.MAIL_FROM = 'sender@example.com';
  process.env.MAIL_FROM_NAME = 'JTAS';
  resetEnvCache();

  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete process.env.MAIL_ALLOWLIST;
  delete process.env.BREVO_API_KEY;
  delete process.env.MAIL_FROM;
  delete process.env.MAIL_FROM_NAME;
  resetEnvCache();
});

describe('parseSender', () => {
  it('takes a bare address and applies the configured name', () => {
    expect(parseSender('a@b.com', 'JTAS')).toEqual({ email: 'a@b.com', name: 'JTAS' });
  });

  it('splits the nodemailer-style "Name <addr>" form', () => {
    expect(parseSender('JTAS Alerts <a@b.com>', 'JTAS')).toEqual({
      email: 'a@b.com',
      name: 'JTAS Alerts',
    });
    expect(parseSender('"JTAS, Ltd" <a@b.com>', 'JTAS').name).toBe('JTAS, Ltd');
  });
});

describe('success', () => {
  it('posts to the transactional endpoint and returns the provider id', async () => {
    fetchMock.mockResolvedValue(jsonResponse(201, { messageId: '<abc@brevo>' }));

    const result = await brevoChannel.send(NOTIFICATION, RECIPIENT);

    expect(result.providerId).toBe('<abc@brevo>');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(BREVO_ENDPOINT);
    expect(init.method).toBe('POST');
    expect(init.headers['api-key']).toBe('test-key-not-a-real-secret');

    const payload = JSON.parse(init.body);
    expect(payload.sender).toEqual({ email: 'sender@example.com', name: 'JTAS' });
    expect(payload.to).toEqual([{ email: RECIPIENT.email, name: RECIPIENT.name }]);
    expect(payload.subject).toBe(NOTIFICATION.subject);
    expect(payload.textContent).toBe(NOTIFICATION.body);
    expect(payload.htmlContent).toBe(NOTIFICATION.html);
    // The row id travels with the message, so a bounce can be traced back.
    expect(payload.headers['X-JTAS-Notification']).toBe('notif-1');
    expect(payload.headers['X-JTAS-Type']).toBe('OVERDUE_MEMBER');
  });

  it('omits htmlContent when the notification has no HTML body', async () => {
    fetchMock.mockResolvedValue(jsonResponse(201, { messageId: 'x' }));

    await brevoChannel.send({ ...NOTIFICATION, html: undefined }, RECIPIENT);

    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).not.toHaveProperty('htmlContent');
  });
});

describe('the CC list is subject to the allowlist too', () => {
  /**
   * `mail.md_recipients` is loaded from an operator-editable setting, and the
   * dispatcher's allowlist check only ever sees the recipient. Without the
   * filter in the adapter, adding an address on the settings screen would put
   * mail in front of it that the guard was specifically holding back.
   */
  it('drops a CC address that is not on the allowlist', async () => {
    process.env.MAIL_ALLOWLIST = 'member@example.com';
    vi.spyOn(settings, 'getSettingArray').mockResolvedValue(['outsider@example.com']);
    fetchMock.mockResolvedValue(jsonResponse(201, { messageId: 'x' }));

    await brevoChannel.send({ ...NOTIFICATION, type: 'OVERDUE_MD' }, RECIPIENT);

    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).not.toHaveProperty('cc');
  });

  it('keeps a CC address that is on the allowlist', async () => {
    process.env.MAIL_ALLOWLIST = 'member@example.com,boss@example.com';
    vi.spyOn(settings, 'getSettingArray').mockResolvedValue(['boss@example.com']);
    fetchMock.mockResolvedValue(jsonResponse(201, { messageId: 'x' }));

    await brevoChannel.send({ ...NOTIFICATION, type: 'OVERDUE_MD' }, RECIPIENT);

    expect(JSON.parse(fetchMock.mock.calls[0][1].body).cc).toEqual([{ email: 'boss@example.com' }]);
  });

  it('never copies anybody on a member-facing type', async () => {
    process.env.MAIL_ALLOWLIST = '';
    vi.spyOn(settings, 'getSettingArray').mockResolvedValue(['boss@example.com']);
    fetchMock.mockResolvedValue(jsonResponse(201, { messageId: 'x' }));

    // OVERDUE_MEMBER: the member does not need the accountant on their chase.
    await brevoChannel.send(NOTIFICATION, RECIPIENT);

    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).not.toHaveProperty('cc');
  });
});

describe('4xx — quota', () => {
  it.each([
    [400, 'not_enough_credits'],
    [429, 'too_many_requests'],
    [403, 'reseller_permission_denied'],
  ])('treats %i %s as a quota stop, not a failure', async (status, code) => {
    fetchMock.mockResolvedValue(jsonResponse(status, { code, message: 'out of credits' }));

    await expect(brevoChannel.send(NOTIFICATION, RECIPIENT)).rejects.toBeInstanceOf(
      ProviderQuotaError,
    );
  });

  it('treats any 429 as a quota stop whatever the code says', () => {
    expect(classifyBrevoResponse(429, { code: 'something_else' })).toBeInstanceOf(
      ProviderQuotaError,
    );
  });

  /**
   * The row must survive a quota refusal untouched. `isRetryable` is what the
   * sweeper consults before failing a row, and a quota error answering `false`
   * here would mark a perfectly good message FAILED at the first attempt.
   */
  it('is retryable, so the row is never failed for it', () => {
    expect(isRetryable(new ProviderQuotaError('out of credits'))).toBe(true);
  });
});

describe('4xx — the message itself', () => {
  it.each([
    [400, 'invalid_parameter', 'a malformed address'],
    [401, 'unauthorised', 'a bad API key'],
    [404, 'document_not_found', 'a missing template'],
  ])('treats %i %s as permanent (%s)', async (status, code) => {
    fetchMock.mockResolvedValue(jsonResponse(status, { code, message: 'nope' }));

    const error = await brevoChannel.send(NOTIFICATION, RECIPIENT).catch((e) => e);

    expect(error).toBeInstanceOf(PermanentChannelError);
    // Permanent means the sweeper fails it now rather than retrying five times.
    expect(isRetryable(error)).toBe(false);
  });

  it('refuses before the network when the API key is missing', async () => {
    delete process.env.BREVO_API_KEY;
    resetEnvCache();

    await expect(brevoChannel.send(NOTIFICATION, RECIPIENT)).rejects.toBeInstanceOf(
      PermanentChannelError,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses a recipient with no address', async () => {
    await expect(
      brevoChannel.send(NOTIFICATION, { ...RECIPIENT, email: '' }),
    ).rejects.toBeInstanceOf(PermanentChannelError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('5xx and transport', () => {
  it.each([500, 502, 503])('retries a %i', async (status) => {
    fetchMock.mockResolvedValue(jsonResponse(status, { message: 'upstream' }));

    const error = await brevoChannel.send(NOTIFICATION, RECIPIENT).catch((e) => e);

    expect(error).toBeInstanceOf(TransientChannelError);
    expect(isRetryable(error)).toBe(true);
  });

  it('retries a refused connection', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(brevoChannel.send(NOTIFICATION, RECIPIENT)).rejects.toBeInstanceOf(
      TransientChannelError,
    );
  });

  it('retries a timeout', async () => {
    fetchMock.mockRejectedValue(Object.assign(new Error('timed out'), { name: 'TimeoutError' }));

    await expect(brevoChannel.send(NOTIFICATION, RECIPIENT)).rejects.toBeInstanceOf(
      TransientChannelError,
    );
  });

  it('survives an error body that is not JSON', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => {
        throw new SyntaxError('not json');
      },
    } as unknown as Response);

    await expect(brevoChannel.send(NOTIFICATION, RECIPIENT)).rejects.toBeInstanceOf(
      TransientChannelError,
    );
  });

  it('survives a success body that is not JSON', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => {
        throw new SyntaxError('not json');
      },
    } as unknown as Response);

    // Accepted is accepted; the id is simply unknown.
    await expect(brevoChannel.send(NOTIFICATION, RECIPIENT)).resolves.toEqual({
      providerId: undefined,
    });
  });
});
