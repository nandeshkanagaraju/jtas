/**
 * Password policy rules — pure, dependency-free, and safe to import from a
 * client component.
 *
 * Split out from `password.ts` deliberately. That module imports bcryptjs; the
 * change-password screen needs only these functions for its live strength hint,
 * and importing them from there dragged the whole bcrypt implementation into
 * the browser bundle — about 40 kB of code that has no business running on a
 * client, for a check that is not a security control anyway.
 */
import { validationError } from '@/lib/errors';
import { passwordSchema } from '@/lib/validation/auth';

import { isCommonPassword } from './common-passwords';

export interface PasswordPolicyResult {
  valid: boolean;
  /** User-facing reasons, empty when `valid`. */
  problems: string[];
}

/**
 * Applies the full policy: the shared Zod rules plus the common-password
 * blocklist. Pure and synchronous, so the client can call it for live feedback.
 */
export function checkPasswordPolicy(candidate: string): PasswordPolicyResult {
  const problems: string[] = [];

  const parsed = passwordSchema.safeParse(candidate);
  if (!parsed.success) {
    problems.push(...parsed.error.issues.map((issue) => issue.message));
  }

  if (isCommonPassword(candidate)) {
    problems.push('This password is too common. Choose something less guessable.');
  }

  return { valid: problems.length === 0, problems };
}

/**
 * Policy gate for the server.
 *
 * @throws {AppError} `VALIDATION_ERROR` listing every rule the password breaks.
 */
export function assertPasswordPolicy(candidate: string, field = 'newPassword'): void {
  const { valid, problems } = checkPasswordPolicy(candidate);
  if (!valid) {
    throw validationError(problems[0], { fields: { [field]: problems } });
  }
}

/**
 * A coarse 0–4 strength hint for the change-password screen. Deliberately not
 * a security control — {@link checkPasswordPolicy} is the gate; this only tells
 * the user whether they have done better than the minimum.
 */
export function passwordStrength(candidate: string): 0 | 1 | 2 | 3 | 4 {
  if (!candidate || isCommonPassword(candidate)) return 0;

  let score = 0;
  if (candidate.length >= 8) score++;
  if (candidate.length >= 12) score++;
  if (/[a-z]/.test(candidate) && /[A-Z]/.test(candidate)) score++;
  if (/\d/.test(candidate) && /[^A-Za-z0-9]/.test(candidate)) score++;

  return Math.min(score, 4) as 0 | 1 | 2 | 3 | 4;
}
