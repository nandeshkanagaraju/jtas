/**
 * The allowlist matcher, and the plus-tag rule in particular.
 *
 * The rule exists because the roster is intended to move to Gmail
 * plus-addresses — `+hr@`, `+store@` — which are real, deliverable mailboxes
 * that all land in one inbox. A matcher that "helpfully" normalised
 * `nandeshjeyalakshmi+hr@gmail.com` down to `nandeshjeyalakshmi@gmail.com`
 * would treat every one of them as the allowlisted address and mail all seven,
 * which is exactly the blast the allowlist is there to prevent. Gmail's own
 * delivery collapses the tag; this matcher must not.
 */
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_DAILY_CAP,
  isAllowedRecipient,
  mailGuardConfig,
  parseAllowlist,
  suppressionReason,
} from '@/lib/notifications/mail-guard';

const ALLOWED = 'nandeshjeyalakshmi@gmail.com';
const ALLOWLIST = [ALLOWED, 'nandeshkanagaraju08@gmail.com'];

describe('parseAllowlist', () => {
  it('splits, trims and lowercases', () => {
    expect(parseAllowlist(' A@x.com , B@Y.com ')).toEqual(['a@x.com', 'b@y.com']);
  });

  it('treats unset and empty as no allowlist at all', () => {
    expect(parseAllowlist(undefined)).toEqual([]);
    expect(parseAllowlist('')).toEqual([]);
    expect(parseAllowlist('  ,  ,')).toEqual([]);
  });

  it('keeps the plus-tag exactly as written', () => {
    expect(parseAllowlist('a+hr@x.com')).toEqual(['a+hr@x.com']);
  });
});

describe('isAllowedRecipient', () => {
  it('allows everything when the list is empty — the production posture', () => {
    expect(isAllowedRecipient('anyone@anywhere.com', [])).toBe(true);
  });

  it('allows an address on the list, whatever its case', () => {
    expect(isAllowedRecipient(ALLOWED, ALLOWLIST)).toBe(true);
    expect(isAllowedRecipient('NandeshJeyalakshmi@Gmail.com', ALLOWLIST)).toBe(true);
    expect(isAllowedRecipient(`  ${ALLOWED}  `, ALLOWLIST)).toBe(true);
  });

  it('refuses an address that is not on the list', () => {
    expect(isAllowedRecipient('hr@jaraaglobal.com', ALLOWLIST)).toBe(false);
    expect(isAllowedRecipient('md@demo.invalid', ALLOWLIST)).toBe(false);
  });

  /**
   * The load-bearing case. Each of these is a *different mailbox* to this
   * matcher, even though Gmail would deliver all of them to the one inbox that
   * is on the list.
   */
  it.each([
    'nandeshjeyalakshmi+hr@gmail.com',
    'nandeshjeyalakshmi+planning@gmail.com',
    'nandeshjeyalakshmi+purchase@gmail.com',
    'nandeshjeyalakshmi+store@gmail.com',
    'nandeshjeyalakshmi+quality@gmail.com',
    'nandeshjeyalakshmi+dispatch@gmail.com',
    'nandeshjeyalakshmi+accounts@gmail.com',
    'nandeshjeyalakshmi+admin@gmail.com',
  ])('does NOT collapse %s to the bare allowlisted address', (tagged) => {
    expect(isAllowedRecipient(tagged, ALLOWLIST)).toBe(false);
  });

  it('allows a plus-tagged address when that exact tag is listed', () => {
    const tagged = 'nandeshjeyalakshmi+hr@gmail.com';
    expect(isAllowedRecipient(tagged, [tagged])).toBe(true);
    // and still not its bare form, in the other direction
    expect(isAllowedRecipient(ALLOWED, [tagged])).toBe(false);
  });

  it('does not match on a prefix or a substring', () => {
    expect(isAllowedRecipient('nandeshjeyalakshmi@gmail.com.evil.com', ALLOWLIST)).toBe(false);
    expect(isAllowedRecipient('xnandeshjeyalakshmi@gmail.com', ALLOWLIST)).toBe(false);
  });
});

describe('suppressionReason', () => {
  it('names the address and says the notification itself was fine', () => {
    const reason = suppressionReason('hr@jaraaglobal.com');
    expect(reason).toContain('hr@jaraaglobal.com');
    expect(reason).toContain('MAIL_ALLOWLIST');
    expect(reason).toMatch(/only the email was withheld/i);
  });
});

describe('mailGuardConfig', () => {
  /** `NodeJS.ProcessEnv` requires NODE_ENV in this project's types. */
  const envWith = (extra: Record<string, string> = {}): NodeJS.ProcessEnv => ({
    NODE_ENV: 'test',
    ...extra,
  });

  it('defaults the cap to 250, under Brevo free tier of 300', () => {
    expect(mailGuardConfig(envWith()).cap).toBe(DEFAULT_DAILY_CAP);
    expect(DEFAULT_DAILY_CAP).toBeLessThan(300);
  });

  it('reads the cap, and ignores a value that is not a positive number', () => {
    expect(mailGuardConfig(envWith({ MAIL_DAILY_CAP: '10' })).cap).toBe(10);
    expect(mailGuardConfig(envWith({ MAIL_DAILY_CAP: 'lots' })).cap).toBe(DEFAULT_DAILY_CAP);
    expect(mailGuardConfig(envWith({ MAIL_DAILY_CAP: '0' })).cap).toBe(DEFAULT_DAILY_CAP);
    expect(mailGuardConfig(envWith({ MAIL_DAILY_CAP: '-5' })).cap).toBe(DEFAULT_DAILY_CAP);
  });

  it('gates push separately from mail, so either can be turned off alone', () => {
    expect(mailGuardConfig(envWith()).pushEnabled).toBe(false);
    expect(mailGuardConfig(envWith({ PUSH_ENABLED: 'true' })).pushEnabled).toBe(true);
    // A populated mail allowlist says nothing about push.
    expect(mailGuardConfig(envWith({ MAIL_ALLOWLIST: ALLOWED })).pushEnabled).toBe(false);
  });
});
