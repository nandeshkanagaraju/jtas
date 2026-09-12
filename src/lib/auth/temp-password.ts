/**
 * Temporary password generation.
 *
 * Used when an account is created and when an administrator resets one. The
 * value is shown to a human exactly once, never stored in plain text, and never
 * logged — only its bcrypt hash reaches the database, and `mustChangePassword`
 * guarantees it survives a single sign-in.
 */
import { randomBytes } from 'node:crypto';

import { checkPasswordPolicy } from './password-policy';

/**
 * Base58: the digits and letters minus `0`, `O`, `I` and `l`.
 *
 * The excluded four are the characters people misread when a password is
 * dictated over a phone or copied off a printed sheet, which is exactly how a
 * temporary password reaches a shop-floor member.
 */
export const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/** Long enough that the 16 characters carry ~94 bits regardless of policy. */
export const TEMP_PASSWORD_LENGTH = 16;

/**
 * Draws `length` characters uniformly from the alphabet.
 *
 * Uses rejection sampling rather than `byte % alphabet.length`: 256 is not a
 * multiple of 58, so the modulo would make the first 24 characters of the
 * alphabet measurably more likely than the rest.
 */
function drawFromAlphabet(length: number): string {
  const alphabet = BASE58_ALPHABET;
  // The largest multiple of the alphabet size that fits in a byte. Bytes at or
  // above it are discarded so the remainder stays uniform.
  const ceiling = Math.floor(256 / alphabet.length) * alphabet.length;

  let out = '';
  while (out.length < length) {
    // Over-draw so the common case needs a single syscall.
    for (const byte of randomBytes((length - out.length) * 2)) {
      if (byte >= ceiling) continue;
      out += alphabet[byte % alphabet.length];
      if (out.length === length) break;
    }
  }

  return out;
}

/**
 * Generates a temporary password that is guaranteed to satisfy the M1 password
 * policy — at least one letter and one digit, and not on the common-password
 * blocklist.
 *
 * A uniform 16-character base58 draw misses the digit requirement about once in
 * 2,500 attempts, so the result is re-drawn rather than patched: substituting a
 * digit at a fixed position would leak where it is.
 */
export function generateTempPassword(length: number = TEMP_PASSWORD_LENGTH): string {
  for (let attempt = 0; attempt < 100; attempt++) {
    const candidate = drawFromAlphabet(length);
    if (checkPasswordPolicy(candidate).valid) return candidate;
  }

  // Unreachable in practice; failing loudly beats returning a weak password.
  throw new Error('Could not generate a policy-compliant temporary password.');
}
