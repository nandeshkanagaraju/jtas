import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { verifyAccessToken } from '@/lib/auth/jwt';
import type { AppError } from '@/lib/errors';
import {
  approveSignInRequest,
  listSignInRequests,
  rejectSignInRequest,
  requestSignInLink,
  signInRequestStatus,
  signInWithLink,
} from '@/lib/services/auth';
import { resetEnvCache } from '@/lib/utils/env';

import { auditActionsFor, createTestUser, resetAuthTables, testDb } from './helpers/db';
import { failNextSends, restoreMail, sentMails, useCapturingMail } from './helpers/mail';

const ctx = { ipAddress: '203.0.113.9', userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/130' };
const DEV = 'dev@example.com';

function linkTokenFrom(body: string): string {
  const match = /\/login\/link\?token=([A-Za-z0-9_\-%]+)/.exec(body);
  if (!match) throw new Error(`no link in mail: ${body}`);
  return decodeURIComponent(match[1]);
}

beforeEach(async () => {
  vi.stubEnv('DEVELOPER_EMAILS', DEV);
  resetEnvCache();
  await resetAuthTables();
  useCapturingMail();
});

afterAll(async () => {
  vi.unstubAllEnvs();
  resetEnvCache();
  restoreMail();
  await resetAuthTables();
  await testDb.$disconnect();
});

describe('sign-in by approved link', () => {
  it('asks the developer, mails the member a one-time link, and signs them in once', async () => {
    const developer = await createTestUser({ email: DEV, role: 'ADMIN', name: 'Dev' });
    const member = await createTestUser({ email: 'prod@jaraaglobal.in', name: 'Production' });

    const { handle } = await requestSignInLink(
      { email: 'prod@jaraaglobal.in', rememberDevice: true },
      ctx,
    );
    expect(await signInRequestStatus(handle)).toBe('PENDING');

    // The developer was told; nothing has gone to the member yet.
    const [notice] = sentMails();
    expect(notice).toMatchObject({ to: DEV, type: 'SIGN_IN_REQUEST' });
    expect(sentMails()).toHaveLength(1);

    const { pending } = await listSignInRequests();
    expect(pending).toHaveLength(1);
    expect(pending[0].user.email).toBe('prod@jaraaglobal.in');

    await approveSignInRequest(pending[0].id, { id: developer.id }, ctx);
    expect(await signInRequestStatus(handle)).toBe('APPROVED');

    const linkMail = sentMails().find((mail) => mail.type === 'SIGN_IN_LINK');
    expect(linkMail?.to).toBe('prod@jaraaglobal.in');
    const token = linkTokenFrom(linkMail!.body);

    // Only the hash is stored.
    const row = await testDb.signInRequest.findFirstOrThrow({ where: { userId: member.id } });
    expect(row.linkHash).not.toBe(token);
    expect(row.pollHash).not.toBe(handle);

    const result = await signInWithLink(token, ctx);
    expect(result.user.id).toBe(member.id);
    await expect(verifyAccessToken(result.tokens.accessToken)).resolves.toMatchObject({
      sub: member.id,
    });
    expect(await signInRequestStatus(handle)).toBe('USED');

    // Second use is refused.
    await expect(signInWithLink(token, ctx)).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    } satisfies Partial<AppError>);

    expect(await auditActionsFor(member.id)).toEqual(
      expect.arrayContaining(['SIGN_IN_LINK_REQUESTED', 'SIGN_IN_LINK_APPROVED', 'LOGIN_SUCCESS']),
    );
  });

  it('answers an unknown address exactly like a real one, and stores nothing', async () => {
    await createTestUser({ email: DEV, role: 'ADMIN' });

    const { handle } = await requestSignInLink(
      { email: 'nobody@example.com', rememberDevice: false },
      ctx,
    );

    expect(handle.length).toBeGreaterThan(20);
    expect(await signInRequestStatus(handle)).toBe('PENDING');
    expect(await testDb.signInRequest.count()).toBe(0);
    expect(sentMails()).toHaveLength(0);
  });

  it('a declined request sends no link', async () => {
    const developer = await createTestUser({ email: DEV, role: 'ADMIN' });
    await createTestUser({ email: 'qa@jaraaglobal.in' });

    const { handle } = await requestSignInLink(
      { email: 'qa@jaraaglobal.in', rememberDevice: false },
      ctx,
    );
    const { pending } = await listSignInRequests();
    await rejectSignInRequest(pending[0].id, { id: developer.id }, ctx);

    expect(await signInRequestStatus(handle)).toBe('REJECTED');
    expect(sentMails().filter((mail) => mail.type === 'SIGN_IN_LINK')).toHaveLength(0);
    await expect(
      approveSignInRequest(pending[0].id, { id: developer.id }, ctx),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('a newer request replaces the waiting one', async () => {
    const developer = await createTestUser({ email: DEV, role: 'ADMIN' });
    await createTestUser({ email: 'stores@jaraaglobal.in' });

    const first = await requestSignInLink(
      { email: 'stores@jaraaglobal.in', rememberDevice: false },
      ctx,
    );
    await requestSignInLink({ email: 'stores@jaraaglobal.in', rememberDevice: false }, ctx);

    expect(await signInRequestStatus(first.handle)).toBe('EXPIRED');
    const { pending } = await listSignInRequests();
    expect(pending).toHaveLength(1);

    // The developer is mailed once, not once per click.
    expect(sentMails().filter((mail) => mail.type === 'SIGN_IN_REQUEST')).toHaveLength(1);

    const stale = await testDb.signInRequest.findFirstOrThrow({ where: { status: 'EXPIRED' } });
    await expect(approveSignInRequest(stale.id, { id: developer.id }, ctx)).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });

  it('puts the request back to waiting when the link mail fails', async () => {
    const developer = await createTestUser({ email: DEV, role: 'ADMIN' });
    await createTestUser({ email: 'cnc@jaraaglobal.in' });

    const { handle } = await requestSignInLink(
      { email: 'cnc@jaraaglobal.in', rememberDevice: false },
      ctx,
    );
    const { pending } = await listSignInRequests();

    failNextSends(1);
    await expect(
      approveSignInRequest(pending[0].id, { id: developer.id }, ctx),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(await signInRequestStatus(handle)).toBe('PENDING');

    await approveSignInRequest(pending[0].id, { id: developer.id }, ctx);
    expect(await signInRequestStatus(handle)).toBe('APPROVED');
  });

  it('refuses an expired link', async () => {
    const developer = await createTestUser({ email: DEV, role: 'ADMIN' });
    await createTestUser({ email: 'late@jaraaglobal.in' });

    await requestSignInLink({ email: 'late@jaraaglobal.in', rememberDevice: false }, ctx);
    const { pending } = await listSignInRequests();
    await approveSignInRequest(pending[0].id, { id: developer.id }, ctx);
    const token = linkTokenFrom(sentMails().find((mail) => mail.type === 'SIGN_IN_LINK')!.body);

    await testDb.signInRequest.update({
      where: { id: pending[0].id },
      data: { linkExpiresAt: new Date(Date.now() - 1000) },
    });

    await expect(signInWithLink(token, ctx)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });
});
