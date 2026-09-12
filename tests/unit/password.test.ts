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
import { AppError } from '@/lib/errors';

describe('hashPassword / verifyPassword', () => {
  it('produces a bcrypt hash at the cost SDD 8.1 requires', async () => {
    const hash = await hashPassword('Jaraa@2026');
    // $2a$12$... — the cost is encoded in the hash itself.
    expect(hash).toMatch(/^\$2[aby]\$12\$/);
    expect(BCRYPT_COST).toBe(12);
  });

  it('verifies a correct password', async () => {
    const hash = await hashPassword('Jaraa@2026');
    await expect(verifyPassword('Jaraa@2026', hash)).resolves.toBe(true);
  });

  it('rejects a wrong password, including case differences', async () => {
    const hash = await hashPassword('Jaraa@2026');
    await expect(verifyPassword('jaraa@2026', hash)).resolves.toBe(false);
    await expect(verifyPassword('', hash)).resolves.toBe(false);
  });

  it('salts, so the same password hashes differently every time', async () => {
    const [a, b] = await Promise.all([hashPassword('Jaraa@2026'), hashPassword('Jaraa@2026')]);
    expect(a).not.toBe(b);
    await expect(verifyPassword('Jaraa@2026', a)).resolves.toBe(true);
    await expect(verifyPassword('Jaraa@2026', b)).resolves.toBe(true);
  });

  it('denies access rather than throwing on a corrupted or empty hash', async () => {
    await expect(verifyPassword('anything', '')).resolves.toBe(false);
    await expect(verifyPassword('anything', 'not-a-bcrypt-hash')).resolves.toBe(false);
  });
});

describe('checkPasswordPolicy', () => {
  it('accepts a password meeting every rule', () => {
    expect(checkPasswordPolicy('Shopfloor7').valid).toBe(true);
    expect(checkPasswordPolicy('Jaraa@2026').valid).toBe(true);
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
    expect(isCommonPassword('Shopfloor7')).toBe(false);
  });

  it('rejects a password longer than 128 characters', () => {
    expect(checkPasswordPolicy(`${'a'.repeat(128)}1`).valid).toBe(false);
  });
});

describe('assertPasswordPolicy', () => {
  it('is silent for a valid password', () => {
    expect(() => assertPasswordPolicy('Shopfloor7')).not.toThrow();
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
