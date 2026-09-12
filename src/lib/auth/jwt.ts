/**
 * Token minting and verification (SDD section 8.2).
 *
 * Two independent tokens with two independent secrets:
 *
 *   access  — 15 minutes, carries the claims middleware needs to route a
 *             request without touching the database.
 *   refresh — 12 hours by default, 30 days on a remembered device (FR-04).
 *             Single-use: every refresh rotates it within its family, and
 *             presenting a consumed token invalidates the whole family.
 *
 * `jose` is used rather than `jsonwebtoken` because it runs on the edge
 * runtime, which is where Next middleware verifies the access token.
 */
import { jwtVerify, SignJWT, type JWTPayload } from 'jose';

import { unauthenticated } from '@/lib/errors';

/** SDD section 8.2. */
export const ACCESS_TTL_SECONDS = 15 * 60;

/** FR-04: a session expires after 12 hours idle… */
export const REFRESH_TTL_SECONDS = 12 * 60 * 60;

/** …unless the user marked the device as theirs, which extends it to 30 days. */
export const REFRESH_TTL_SECONDS_REMEMBERED = 30 * 24 * 60 * 60;

const ALGORITHM = 'HS256';
const ISSUER = 'jtas';
const AUDIENCE = 'jtas-app';

/**
 * Reads a signing secret straight from `process.env` rather than through the
 * validated `env()` helper.
 *
 * This module is imported by Next middleware, which runs on the edge runtime.
 * Going through `env()` there would drag the whole server schema — and its
 * requirement that `DATABASE_URL` be present — into the edge bundle for no
 * benefit. The two secrets are validated here instead, with the same 32-character
 * floor.
 */
function secret(name: 'JWT_SECRET' | 'REFRESH_SECRET'): Uint8Array {
  const value = process.env[name];

  if (!value || value.length < 32) {
    throw new Error(`${name} is missing or shorter than 32 characters. See .env.example.`);
  }

  return new TextEncoder().encode(value);
}

function accessKey(): Uint8Array {
  return secret('JWT_SECRET');
}

function refreshKey(): Uint8Array {
  return secret('REFRESH_SECRET');
}

// ---------------------------------------------------------------------------
// Claims
// ---------------------------------------------------------------------------

/**
 * Access-token claims.
 *
 * Only what middleware needs to route: the role for the landing redirect and
 * `mustChangePassword` for the forced-change gate. These are a snapshot taken
 * at sign-in and can be up to 15 minutes stale, which is why every route
 * handler re-reads the user from the database rather than trusting them for an
 * authorisation decision (see `requireAuth` in `session.ts`).
 */
export interface AccessClaims {
  /** User id. */
  sub: string;
  role: 'MD' | 'DEPUTY_MD' | 'ADMIN' | 'MEMBER';
  departmentId: string | null;
  mustChangePassword: boolean;
}

/** Refresh-token claims. */
export interface RefreshClaims {
  sub: string;
  /** Rotation family. Reuse of any member revokes all of them. */
  familyId: string;
  /** This token's own id, matched against the stored hash. */
  jti: string;
}

// ---------------------------------------------------------------------------
// Signing
// ---------------------------------------------------------------------------

export async function signAccessToken(claims: AccessClaims): Promise<string> {
  return new SignJWT({
    role: claims.role,
    departmentId: claims.departmentId,
    mustChangePassword: claims.mustChangePassword,
    typ: 'access',
  })
    .setProtectedHeader({ alg: ALGORITHM })
    .setSubject(claims.sub)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${ACCESS_TTL_SECONDS}s`)
    .sign(accessKey());
}

export async function signRefreshToken(
  claims: RefreshClaims,
  ttlSeconds: number = REFRESH_TTL_SECONDS,
): Promise<string> {
  return new SignJWT({ familyId: claims.familyId, typ: 'refresh' })
    .setProtectedHeader({ alg: ALGORITHM })
    .setSubject(claims.sub)
    .setJti(claims.jti)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${ttlSeconds}s`)
    .sign(refreshKey());
}

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

/**
 * Verifies an access token.
 *
 * Returns `null` rather than throwing, because an expired token is the normal
 * case rather than an error — middleware treats it as a cue to refresh.
 */
export async function verifyAccessToken(token: string): Promise<AccessClaims | null> {
  try {
    const { payload } = await jwtVerify(token, accessKey(), {
      issuer: ISSUER,
      audience: AUDIENCE,
      algorithms: [ALGORITHM],
    });

    // Reject a refresh token presented as an access token: the two secrets
    // differ, so this cannot normally happen, but the check costs nothing and
    // makes a future shared-secret mistake non-exploitable.
    if (payload.typ !== 'access') return null;

    return toAccessClaims(payload);
  } catch {
    return null;
  }
}

/**
 * Verifies a refresh token's signature and expiry.
 *
 * Signature validity is necessary but not sufficient — the caller must still
 * check the stored row for reuse. See `rotateRefreshToken` in the auth service.
 */
export async function verifyRefreshToken(token: string): Promise<RefreshClaims | null> {
  try {
    const { payload } = await jwtVerify(token, refreshKey(), {
      issuer: ISSUER,
      audience: AUDIENCE,
      algorithms: [ALGORITHM],
    });

    if (payload.typ !== 'refresh') return null;
    if (typeof payload.sub !== 'string' || typeof payload.jti !== 'string') return null;
    if (typeof payload.familyId !== 'string') return null;

    return { sub: payload.sub, familyId: payload.familyId, jti: payload.jti };
  } catch {
    return null;
  }
}

/** Narrows a verified payload, rejecting anything with unexpected claim shapes. */
function toAccessClaims(payload: JWTPayload): AccessClaims | null {
  const { sub, role, departmentId, mustChangePassword } = payload;

  if (typeof sub !== 'string') return null;
  if (role !== 'MD' && role !== 'DEPUTY_MD' && role !== 'ADMIN' && role !== 'MEMBER') return null;
  if (departmentId !== null && typeof departmentId !== 'string') return null;
  if (typeof mustChangePassword !== 'boolean') return null;

  return { sub, role, departmentId, mustChangePassword };
}

/**
 * Same as {@link verifyAccessToken} but throws, for callers that treat a
 * missing session as an error rather than a redirect.
 *
 * @throws {AppError} `UNAUTHENTICATED`
 */
export async function requireAccessToken(token: string | undefined): Promise<AccessClaims> {
  if (!token) throw unauthenticated();
  const claims = await verifyAccessToken(token);
  if (!claims) throw unauthenticated('Your session has expired. Please sign in again.');
  return claims;
}

// ---------------------------------------------------------------------------
// Storage hashing
// ---------------------------------------------------------------------------

/**
 * SHA-256 of a refresh token, hex-encoded.
 *
 * The database stores the hash, never the token. A leaked backup therefore
 * yields nothing usable, and the unique index on `tokenHash` still makes reuse
 * detection an exact lookup.
 *
 * Uses Web Crypto rather than `node:crypto` so the same helper works in an edge
 * runtime.
 */
export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

/** A random opaque id for a token or a rotation family. */
export function newTokenId(): string {
  return crypto.randomUUID();
}
