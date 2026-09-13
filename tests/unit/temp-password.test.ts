import { describe, expect, it } from 'vitest';

import { checkPasswordPolicy } from '@/lib/auth/password-policy';
import {
  BASE58_ALPHABET,
  TEMP_PASSWORD_LENGTH,
  generateTempPassword,
} from '@/lib/auth/temp-password';

describe('BASE58_ALPHABET', () => {
  it('excludes the four characters people misread', () => {
    for (const ambiguous of ['0', 'O', 'I', 'l']) {
      expect(BASE58_ALPHABET, `should not contain ${ambiguous}`).not.toContain(ambiguous);
    }
  });

  it('has 58 distinct characters', () => {
    expect(BASE58_ALPHABET).toHaveLength(58);
    expect(new Set(BASE58_ALPHABET).size).toBe(58);
  });
});

describe('generateTempPassword', () => {
  it('is 16 characters by default', () => {
    expect(generateTempPassword()).toHaveLength(TEMP_PASSWORD_LENGTH);
    expect(generateTempPassword(24)).toHaveLength(24);
  });

  it('uses only base58 characters', () => {
    for (let i = 0; i < 200; i++) {
      for (const char of generateTempPassword()) {
        expect(BASE58_ALPHABET, `unexpected character "${char}"`).toContain(char);
      }
    }
  });

  it('always satisfies the M1 password policy', () => {
    // The policy needs a letter and a digit; a uniform base58 draw misses the
    // digit roughly once in 2,500, so this is the assertion that matters.
    for (let i = 0; i < 2_000; i++) {
      const password = generateTempPassword();
      const { valid, problems } = checkPasswordPolicy(password);
      expect(valid, `"${password}" failed: ${problems.join(', ')}`).toBe(true);
    }
  });

  it('never returns the same value twice in a row', () => {
    // The narrow version of the property below: two back-to-back calls, which
    // is exactly what `pnpm user:reset-password` run twice does.
    const first = generateTempPassword();
    const second = generateTempPassword();

    expect(first).not.toBe(second);
    expect(checkPasswordPolicy(first).valid).toBe(true);
    expect(checkPasswordPolicy(second).valid).toBe(true);
  });

  it('never repeats', () => {
    const generated = new Set(Array.from({ length: 1_000 }, () => generateTempPassword()));
    expect(generated.size).toBe(1_000);
  });

  it('draws roughly uniformly, so modulo bias is not reintroduced', () => {
    // Rejection sampling is the only reason this holds. With `byte % 58` the
    // first 24 characters of the alphabet would appear about 25% more often.
    const counts = new Map<string, number>();
    const samples = 40_000;

    for (let i = 0; i < samples / TEMP_PASSWORD_LENGTH; i++) {
      for (const char of generateTempPassword()) {
        counts.set(char, (counts.get(char) ?? 0) + 1);
      }
    }

    const expected = samples / BASE58_ALPHABET.length;
    for (const char of BASE58_ALPHABET) {
      const actual = counts.get(char) ?? 0;
      // Generous band: this is a bias check, not a randomness certification.
      expect(actual, `"${char}" appeared ${actual} times, expected ~${expected}`).toBeGreaterThan(
        expected * 0.6,
      );
      expect(actual).toBeLessThan(expected * 1.4);
    }
  });
});
