import { describe, expect, it } from 'vitest';

import { isCommonPassword } from '@/lib/auth/common-passwords';
import {
  BCRYPT_COST,
  assertPasswordPolicy,
  checkPasswordPolicy,
  hashPassword,
  passwordStrength,
  verifyPassword,
} from '@/lib/auth/password';
import { generateTempPassword } from '@/lib/auth/temp-password';
import { AppError } from '@/lib/errors';

/*
 * Generated per run. The invalid and blocklisted fixtures below stay literal —
 * 'abcdefgh' and 'password1' are the input a rule is being tested against, not
 * credentials, and generating them would delete the assertion.
 */
const VALID = generateTempPassword();
const OTHER = generateTempPassword();

describe('hashPassword / verifyPassword', () => {
  it('produces a bcrypt hash at the cost SDD 8.1 requires', async () => {
    const hash = await hashPassword(VALID);
    // $2a$12$... — the cost is encoded in the hash itself.
    expect(hash).toMatch(/^\$2[aby]\$12\$/);
    expect(BCRYPT_COST).toBe(12);
  });

  it('verifies a correct password', async () => {
    const hash = await hashPassword(VALID);
    await expect(verifyPassword(VALID, hash)).resolves.toBe(true);
  });

  it('rejects a wrong password, including case differences', async () => {
    const hash = await hashPassword(VALID);
    await expect(verifyPassword(VALID.toLowerCase(), hash)).resolves.toBe(false);
    await expect(verifyPassword(OTHER, hash)).resolves.toBe(false);
    await expect(verifyPassword('', hash)).resolves.toBe(false);
  });

  it('salts, so the same password hashes differently every time', async () => {
    const [a, b] = await Promise.all([hashPassword(VALID), hashPassword(VALID)]);
    expect(a).not.toBe(b);
    await expect(verifyPassword(VALID, a)).resolves.toBe(true);
    await expect(verifyPassword(VALID, b)).resolves.toBe(true);
  });

  it('denies access rather than throwing on a corrupted or empty hash', async () => {
    await expect(verifyPassword('anything', '')).resolves.toBe(false);
    await expect(verifyPassword('anything', 'not-a-bcrypt-hash')).resolves.toBe(false);
  });
});

describe('checkPasswordPolicy', () => {
  it('accepts a password meeting every rule', () => {
    expect(checkPasswordPolicy(VALID).valid).toBe(true);
    expect(checkPasswordPolicy(OTHER).valid).toBe(true);
  });

  it('rejects anything shorter than 8 characters', () => {
    const result = checkPasswordPolicy('Abc123');
    expect(result.valid).toBe(false);
    expect(result.problems).toContain('Use at least 8 characters.');
  });

  it('requires a letter', () => {
    const result = checkPasswordPolicy('12345678');
    expect(result.valid).toBe(false);
    expect(result.problems).toContain('Include at least one letter.');
  });

  it('requires a digit', () => {
    const result = checkPasswordPolicy('abcdefgh');
    expect(result.valid).toBe(false);
    expect(result.problems).toContain('Include at least one digit.');
  });

  it('reports every broken rule at once, not just the first', () => {
    const result = checkPasswordPolicy('abc');
    expect(result.problems.length).toBeGreaterThanOrEqual(2);
  });

  it('rejects a common password that would otherwise pass the rules', () => {
    // `password1` is 9 characters with a letter and a digit — the length and
    // character rules alone would let it through.
    expect(checkPasswordPolicy('password1').valid).toBe(false);
    expect(checkPasswordPolicy('qwerty123').valid).toBe(false);
    expect(checkPasswordPolicy('welcome1').valid).toBe(false);
  });

  it('matches the blocklist case-insensitively', () => {
    expect(isCommonPassword('PASSWORD1')).toBe(true);
    expect(isCommonPassword('Qwerty123')).toBe(true);
    expect(isCommonPassword(VALID)).toBe(false);
  });

  it('rejects a password longer than 128 characters', () => {
    expect(checkPasswordPolicy(`${'a'.repeat(128)}1`).valid).toBe(false);
  });
});

describe('assertPasswordPolicy', () => {
  it('is silent for a valid password', () => {
    expect(() => assertPasswordPolicy(VALID)).not.toThrow();
  });

  it('throws VALIDATION_ERROR listing every problem under the field name', () => {
    try {
      assertPasswordPolicy('abc', 'newPassword');
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      const appError = error as AppError;
      expect(appError.code).toBe('VALIDATION_ERROR');
      expect(appError.status).toBe(400);
      const fields = appError.details?.fields as Record<string, string[]>;
      expect(fields.newPassword.length).toBeGreaterThanOrEqual(2);
    }
  });
});

describe('passwordStrength', () => {
  it('scores a blocklisted password at zero however long it is', () => {
    expect(passwordStrength('password1')).toBe(0);
    expect(passwordStrength('')).toBe(0);
  });

  it('increases with length, mixed case and symbols', () => {
    const minimal = passwordStrength('abcdefg1');
    const longer = passwordStrength('abcdefghijk1');
    const mixed = passwordStrength('AbcdefghIjk1');
    const full = passwordStrength('Abcdefgh!Jk1');

    expect(longer).toBeGreaterThan(minimal);
    expect(mixed).toBeGreaterThan(longer);
    expect(full).toBeGreaterThan(mixed);
  });

  it('never exceeds 4', () => {
    expect(passwordStrength('Str0ng!Passw0rd#WithEverything')).toBe(4);
  });
});
