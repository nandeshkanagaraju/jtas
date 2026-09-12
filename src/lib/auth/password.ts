/**
 * Password hashing (SDD section 8.1). Server-only — bcryptjs must never reach
 * the browser bundle, so client components import the pure rules from
 * `./password-policy` instead.
 *
 * bcrypt at cost 12 is roughly 250 ms per hash on the target VPS: slow enough
 * to make offline cracking expensive, fast enough for 15 concurrent users, and
 * the reason login cannot run on an edge runtime.
 */
import bcrypt from 'bcryptjs';

/** SDD section 8.1. Changing this invalidates nothing — bcrypt stores the cost. */
export const BCRYPT_COST = 12;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_COST);
}

/**
 * Constant-time comparison of a candidate against a stored hash.
 *
 * Returns `false` rather than throwing on a malformed or empty hash, so a
 * corrupted row denies access instead of crashing the login route.
 */
export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  if (!hash) return false;
  try {
    return await bcrypt.compare(plain, hash);
  } catch {
    return false;
  }
}

// Re-exported so server-side callers have a single import for both halves.
export {
  assertPasswordPolicy,
  checkPasswordPolicy,
  passwordStrength,
  type PasswordPolicyResult,
} from './password-policy';
