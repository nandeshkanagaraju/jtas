/**
 * The 20 most common passwords, rejected outright (build spec M1.1).
 *
 * A policy of "8 characters, a letter and a digit" is satisfied by `password1`
 * and `qwerty123`, which are among the first guesses in any credential-stuffing
 * run. Comparison is case-insensitive because `Password1` is not meaningfully
 * stronger than `password1`.
 */
export const COMMON_PASSWORDS: ReadonlySet<string> = new Set([
  '123456',
  'password',
  '123456789',
  '12345678',
  '12345',
  'qwerty',
  '1234567',
  '111111',
  '1234567890',
  '123123',
  'abc123',
  '1234',
  'password1',
  'iloveyou',
  'qwerty123',
  'admin123',
  'welcome1',
  'monkey123',
  'letmein1',
  'sunshine1',
]);

/** True when `candidate` is on the blocklist, ignoring case. */
export function isCommonPassword(candidate: string): boolean {
  return COMMON_PASSWORDS.has(candidate.toLowerCase());
}
