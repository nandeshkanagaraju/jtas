/**
 * Sign-in by approved email link — the primary way into JTAS.
 *
 *   1. The person types their email on the login page. A request is stored and
 *      the developer is told about it. The browser gets an opaque handle it can
 *      poll with, and nothing else.
 *   2. The developer accepts or declines it from the Sign-in requests screen.
 *      Accepting mails a single-use link to the account's own address.
 *   3. Opening the link and pressing "Continue" signs the person in.
 *
 * The person never needs to know a password, and a stranger who knows an
 * address gets nothing without the developer saying yes *and* access to that
 * mailbox. Password sign-in stays as the fallback.
 *
 * Only SHA-256 hashes of the poll handle and the link token are stored.
 */
import type { SignInRequestStatus, User } from '@prisma/client';

import { developerEmailList } from '@/lib/auth/developer';
import { hashToken } from '@/lib/auth/jwt';
import { prisma } from '@/lib/db/prisma';
import { conflict, notFound, unauthenticated } from '@/lib/errors';
import { channelFor } from '@/lib/notifications/channels';
import {
  renderSignInLinkMail,
  renderSignInRequestedMail,
} from '@/lib/notifications/templates/sign-in-mails';
import { tryWriteAudit, writeAudit } from '@/lib/services/audit-service';
import { env } from '@/lib/utils/env';
import { moduleLogger } from '@/lib/utils/logger';
import { formatIST } from '@/lib/utils/time';

import { issueTokens, toAuthenticatedUser, type LoginResult, type RequestContext } from './tokens';

const log = moduleLogger('auth-sign-in-requests');

/** How long a request waits for the developer before it lapses. */
export const REQUEST_TTL_MINUTES = 30;

/** How long a mailed link works after it is accepted. */
export const LINK_TTL_MINUTES = 15;

/** The developer is mailed at most once per person in this window. */
const APPROVER_MAIL_QUIET_MINUTES = 5;

const ROLE_LABELS: Record<string, string> = {
  MD: 'Managing Director',
  DEPUTY_MD: 'Deputy MD',
  ADMIN: 'Administrator',
  MEMBER: 'Member',
};

export type PublicRequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED' | 'USED';

export interface SignInRequestContext extends RequestContext {
  userAgent: string | null;
}

function base(): string {
  return env().APP_BASE_URL.replace(/\/+$/, '');
}

/** 32 random bytes, base64url. Unguessable, and safe in a URL. */
function randomSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Buffer.from(bytes).toString('base64url');
}

function minutesFromNow(minutes: number, now = new Date()): Date {
  return new Date(now.getTime() + minutes * 60_000);
}

/**
 * Step 1: someone asks for a link.
 *
 * Always returns a handle, whether or not the address belongs to an account,
 * so the login page cannot be used to find out who works here. An unknown or
 * deactivated address simply never gets approved.
 */
export async function requestSignInLink(
  input: { email: string; rememberDevice: boolean },
  ctx: SignInRequestContext,
): Promise<{ handle: string }> {
  const handle = randomSecret();
  const now = new Date();

  const user = await prisma.user.findUnique({ where: { email: input.email } });

  if (!user || !user.isActive || user.isDemo) {
    await tryWriteAudit(prisma, {
      actorId: user?.id ?? null,
      action: 'SIGN_IN_LINK_REQUEST_IGNORED',
      entityType: 'SESSION',
      entityId: user?.id ?? input.email,
      after: {
        reason: !user ? 'UNKNOWN_EMAIL' : !user.isActive ? 'INACTIVE_ACCOUNT' : 'DEMO_ACCOUNT',
        email: input.email,
      },
      ipAddress: ctx.ipAddress,
    });
    return { handle };
  }

  // Was the developer already told about this person a moment ago?
  const recent = await prisma.signInRequest.findFirst({
    where: {
      userId: user.id,
      createdAt: { gt: minutesFromNow(-APPROVER_MAIL_QUIET_MINUTES, now) },
    },
    select: { id: true },
  });

  const request = await prisma.$transaction(async (tx) => {
    // One open request per person: a fresh one replaces any still waiting, so
    // the developer never accepts a stale one for a browser that has gone.
    await tx.signInRequest.updateMany({
      where: { userId: user.id, status: 'PENDING' },
      data: { status: 'EXPIRED' },
    });

    const created = await tx.signInRequest.create({
      data: {
        userId: user.id,
        pollHash: await hashToken(handle),
        rememberDevice: input.rememberDevice,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        expiresAt: minutesFromNow(REQUEST_TTL_MINUTES, now),
      },
    });

    await writeAudit(tx, {
      actorId: user.id,
      action: 'SIGN_IN_LINK_REQUESTED',
      entityType: 'SESSION',
      entityId: user.id,
      after: { requestId: created.id },
      ipAddress: ctx.ipAddress,
    });

    return created;
  });

  if (!recent) {
    await mailApprovers(user, request.createdAt, ctx.ipAddress);
  }

  return { handle };
}

/** Best effort: the request is on the screen whether or not this mail lands. */
async function mailApprovers(requester: User, at: Date, ipAddress: string): Promise<void> {
  const emails = developerEmailList();
  if (emails.length === 0) {
    log.warn('a sign-in link was requested but DEVELOPER_EMAILS is empty; nobody can accept it');
    return;
  }

  const approvers = await prisma.user.findMany({
    where: { email: { in: emails }, isActive: true, id: { not: requester.id } },
    select: { id: true, name: true, email: true },
  });

  const department = requester.departmentId
    ? await prisma.department.findUnique({
        where: { id: requester.departmentId },
        select: { name: true },
      })
    : null;

  for (const approver of approvers) {
    try {
      const mail = await renderSignInRequestedMail({
        approverName: approver.name,
        requesterName: requester.name,
        requesterEmail: requester.email,
        requesterRole: ROLE_LABELS[requester.role] ?? requester.role,
        department: department?.name ?? null,
        requestedAtIst: formatIST(at),
        ipAddress,
        reviewLink: `${base()}/sign-in-requests`,
      });
      await channelFor('EMAIL').send(
        {
          id: `sign-in-request-${requester.id}-${at.getTime()}`,
          type: 'SIGN_IN_REQUEST',
          subject: mail.subject,
          body: mail.text,
          html: mail.html,
          entityType: 'SESSION',
          entityId: requester.id,
        },
        { id: approver.id, name: approver.name, email: approver.email, phone: null },
      );
    } catch (error) {
      log.warn(
        { approverId: approver.id, err: error instanceof Error ? error.message : String(error) },
        'could not mail the developer about a sign-in request',
      );
    }
  }
}

/**
 * What the waiting login page sees. An unknown handle reads as pending, so a
 * made-up address looks exactly like a real one that is still waiting.
 */
export async function signInRequestStatus(handle: string): Promise<PublicRequestStatus> {
  const request = await prisma.signInRequest.findUnique({
    where: { pollHash: await hashToken(handle) },
    select: { status: true, expiresAt: true },
  });

  if (!request) return 'PENDING';
  if (request.status === 'PENDING' && request.expiresAt <= new Date()) return 'EXPIRED';
  return request.status;
}

export interface SignInRequestRow {
  id: string;
  status: SignInRequestStatus | 'EXPIRED';
  createdAt: string;
  expiresAt: string;
  decidedAt: string | null;
  usedAt: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  user: {
    id: string;
    name: string;
    email: string;
    role: string;
    department: string | null;
  };
}

/** The developer's screen: everything waiting, then the last day's decisions. */
export async function listSignInRequests(): Promise<{
  pending: SignInRequestRow[];
  recent: SignInRequestRow[];
}> {
  const now = new Date();
  const rows = await prisma.signInRequest.findMany({
    where: {
      OR: [
        { status: 'PENDING', expiresAt: { gt: now } },
        { createdAt: { gt: new Date(now.getTime() - 24 * 60 * 60_000) } },
      ],
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
    include: {
      user: {
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          department: { select: { name: true } },
        },
      },
    },
  });

  const toRow = (row: (typeof rows)[number]): SignInRequestRow => ({
    id: row.id,
    status: row.status === 'PENDING' && row.expiresAt <= now ? 'EXPIRED' : row.status,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    decidedAt: row.decidedAt?.toISOString() ?? null,
    usedAt: row.usedAt?.toISOString() ?? null,
    ipAddress: row.ipAddress,
    userAgent: row.userAgent,
    user: {
      id: row.user.id,
      name: row.user.name,
      email: row.user.email,
      role: ROLE_LABELS[row.user.role] ?? row.user.role,
      department: row.user.department?.name ?? null,
    },
  });

  const all = rows.map(toRow);
  return {
    pending: all.filter((row) => row.status === 'PENDING'),
    recent: all.filter((row) => row.status !== 'PENDING'),
  };
}

/** How many requests are waiting, for the nav badge. */
export async function pendingSignInRequestCount(): Promise<number> {
  return prisma.signInRequest.count({
    where: { status: 'PENDING', expiresAt: { gt: new Date() } },
  });
}

/**
 * Step 2a: the developer accepts. Mails the single-use link.
 *
 * If the mail cannot be sent the request goes back to waiting, so the
 * developer can try again rather than leaving the person with nothing.
 *
 * @throws {AppError} `NOT_FOUND`, or `CONFLICT` when it was already answered
 *         or has lapsed, or when the mail failed.
 */
export async function approveSignInRequest(
  requestId: string,
  approver: { id: string },
  ctx: RequestContext,
): Promise<void> {
  const request = await prisma.signInRequest.findUnique({
    where: { id: requestId },
    include: { user: true },
  });
  if (!request) throw notFound('Sign-in request');

  const token = randomSecret();
  const now = new Date();

  // Conditional, so two clicks (or two developers) cannot both mail a link.
  const { count } = await prisma.signInRequest.updateMany({
    where: { id: requestId, status: 'PENDING', expiresAt: { gt: now } },
    data: {
      status: 'APPROVED',
      linkHash: await hashToken(token),
      linkExpiresAt: minutesFromNow(LINK_TTL_MINUTES, now),
      decidedAt: now,
      decidedById: approver.id,
    },
  });
  if (count === 0) {
    throw conflict('This request was already answered, replaced or has expired.');
  }

  if (!request.user.isActive) {
    await prisma.signInRequest.update({
      where: { id: requestId },
      data: { status: 'REJECTED', linkHash: null },
    });
    throw conflict('This account has been deactivated, so no link was sent.');
  }

  try {
    const mail = await renderSignInLinkMail({
      name: request.user.name,
      link: `${base()}/login/link?token=${encodeURIComponent(token)}`,
      minutesValid: LINK_TTL_MINUTES,
    });
    await channelFor('EMAIL').send(
      {
        id: `sign-in-link-${request.id}`,
        type: 'SIGN_IN_LINK',
        subject: mail.subject,
        body: mail.text,
        html: mail.html,
        entityType: 'SESSION',
        entityId: request.userId,
      },
      { id: request.user.id, name: request.user.name, email: request.user.email, phone: null },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.warn({ requestId, err: message }, 'sign-in link mail failed; request put back to pending');
    await prisma.signInRequest.update({
      where: { id: requestId },
      data: {
        status: 'PENDING',
        linkHash: null,
        linkExpiresAt: null,
        decidedAt: null,
        decidedById: null,
      },
    });
    throw conflict(`The sign-in link could not be mailed: ${message}`);
  }

  await tryWriteAudit(prisma, {
    actorId: approver.id,
    action: 'SIGN_IN_LINK_APPROVED',
    entityType: 'USER',
    entityId: request.userId,
    after: { requestId, linkExpiresAt: minutesFromNow(LINK_TTL_MINUTES, now).toISOString() },
    ipAddress: ctx.ipAddress,
  });
}

/** Step 2b: the developer declines. */
export async function rejectSignInRequest(
  requestId: string,
  approver: { id: string },
  ctx: RequestContext,
): Promise<void> {
  const request = await prisma.signInRequest.findUnique({
    where: { id: requestId },
    select: { userId: true },
  });
  if (!request) throw notFound('Sign-in request');

  const { count } = await prisma.signInRequest.updateMany({
    where: { id: requestId, status: 'PENDING' },
    data: { status: 'REJECTED', decidedAt: new Date(), decidedById: approver.id },
  });
  if (count === 0) throw conflict('This request was already answered or replaced.');

  await tryWriteAudit(prisma, {
    actorId: approver.id,
    action: 'SIGN_IN_LINK_REJECTED',
    entityType: 'USER',
    entityId: request.userId,
    after: { requestId },
    ipAddress: ctx.ipAddress,
  });
}

const LINK_FAILURE = 'This sign-in link is invalid, expired or already used. Ask for a new one.';

/**
 * Step 3: the person opens the link and presses Continue.
 *
 * Marking the link used and checking it are one conditional update, so the
 * same link cannot sign in twice even when opened in two tabs at once.
 *
 * @throws {AppError} `UNAUTHENTICATED` for any bad, used or expired link.
 */
export async function signInWithLink(token: string, ctx: RequestContext): Promise<LoginResult> {
  const linkHash = await hashToken(token);
  const now = new Date();

  const { count } = await prisma.signInRequest.updateMany({
    where: { linkHash, status: 'APPROVED', usedAt: null, linkExpiresAt: { gt: now } },
    data: { status: 'USED', usedAt: now },
  });

  if (count === 0) {
    await tryWriteAudit(prisma, {
      actorId: null,
      action: 'LOGIN_FAILED',
      entityType: 'SESSION',
      entityId: 'sign-in-link',
      after: { reason: 'BAD_SIGN_IN_LINK' },
      ipAddress: ctx.ipAddress,
    });
    throw unauthenticated(LINK_FAILURE);
  }

  const request = await prisma.signInRequest.findUniqueOrThrow({
    where: { linkHash },
    include: { user: true },
  });

  if (!request.user.isActive) {
    throw unauthenticated('This account has been deactivated. Contact the administrator.');
  }

  return prisma.$transaction(async (tx) => {
    const refreshed = await tx.user.update({
      where: { id: request.userId },
      data: { lastLoginAt: now },
    });

    const tokens = await issueTokens(tx, refreshed, { rememberDevice: request.rememberDevice });

    await writeAudit(tx, {
      actorId: refreshed.id,
      action: 'LOGIN_SUCCESS',
      entityType: 'SESSION',
      entityId: refreshed.id,
      after: {
        method: 'SIGN_IN_LINK',
        requestId: request.id,
        rememberDevice: request.rememberDevice,
      },
      ipAddress: ctx.ipAddress,
    });

    return { user: toAuthenticatedUser(refreshed), tokens };
  });
}
