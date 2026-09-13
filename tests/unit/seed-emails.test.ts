import { describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_MD_EMAIL,
  DEFAULT_MEMBER_EMAIL,
  resolveSeedEmails,
} from '../../prisma/seed-data/users';

const OVERRIDES = {
  SEED_MD_EMAIL: 'someone@gmail.com',
  SEED_MEMBER_EMAIL: 'someone.else@gmail.com',
};

describe('resolveSeedEmails — outside production', () => {
  it('applies both overrides', () => {
    const result = resolveSeedEmails({ ...OVERRIDES, NODE_ENV: 'development' });

    expect(result).toEqual({
      mdEmail: 'someone@gmail.com',
      memberEmail: 'someone.else@gmail.com',
    });
  });

  it('falls back to the go-live roster when unset', () => {
    expect(resolveSeedEmails({ NODE_ENV: 'development' })).toEqual({
      mdEmail: DEFAULT_MD_EMAIL,
      memberEmail: DEFAULT_MEMBER_EMAIL,
    });
  });

  it('treats an empty or whitespace value as unset', () => {
    const result = resolveSeedEmails({
      NODE_ENV: 'development',
      SEED_MD_EMAIL: '   ',
      SEED_MEMBER_EMAIL: '',
    });

    expect(result.mdEmail).toBe(DEFAULT_MD_EMAIL);
    expect(result.memberEmail).toBe(DEFAULT_MEMBER_EMAIL);
  });

  it('applies one override without disturbing the other', () => {
    const result = resolveSeedEmails({
      NODE_ENV: 'development',
      SEED_MD_EMAIL: 'someone@gmail.com',
    });

    expect(result.mdEmail).toBe('someone@gmail.com');
    expect(result.memberEmail).toBe(DEFAULT_MEMBER_EMAIL);
  });

  it('says nothing when there is nothing to warn about', () => {
    const warn = vi.fn();
    resolveSeedEmails({ ...OVERRIDES, NODE_ENV: 'development' }, warn);

    expect(warn).not.toHaveBeenCalled();
  });
});

describe('resolveSeedEmails — in production', () => {
  it('ignores both overrides and seeds the go-live roster', () => {
    // A laptop carrying SEED_MD_EMAIL that seeds the client's database would
    // otherwise make a personal Gmail address the Managing Director of record.
    const result = resolveSeedEmails({ ...OVERRIDES, NODE_ENV: 'production' }, vi.fn());

    expect(result).toEqual({
      mdEmail: DEFAULT_MD_EMAIL,
      memberEmail: DEFAULT_MEMBER_EMAIL,
    });
  });

  it('warns loudly, naming each variable it ignored', () => {
    const warn = vi.fn();
    resolveSeedEmails({ ...OVERRIDES, NODE_ENV: 'production' }, warn);

    expect(warn).toHaveBeenCalledOnce();
    const message = warn.mock.calls[0][0] as string;

    expect(message).toContain('SEED_MD_EMAIL');
    expect(message).toContain('SEED_MEMBER_EMAIL');
    expect(message).toContain(DEFAULT_MD_EMAIL);
    // Silently doing the right thing teaches nobody that the variable is set.
    expect(message).toContain('production');
  });

  it('names only the variable that was actually set', () => {
    const warn = vi.fn();
    resolveSeedEmails({ NODE_ENV: 'production', SEED_MEMBER_EMAIL: 'x@gmail.com' }, warn);

    const message = warn.mock.calls[0][0] as string;
    expect(message).toContain('SEED_MEMBER_EMAIL');
    expect(message).not.toContain('SEED_MD_EMAIL');
  });

  it('stays silent when no override was set', () => {
    const warn = vi.fn();
    const result = resolveSeedEmails({ NODE_ENV: 'production' }, warn);

    expect(warn).not.toHaveBeenCalled();
    expect(result.mdEmail).toBe(DEFAULT_MD_EMAIL);
  });

  it('never returns an address outside the company domain in production', () => {
    const result = resolveSeedEmails(
      { NODE_ENV: 'production', SEED_MD_EMAIL: 'attacker@evil.test' },
      vi.fn(),
    );

    expect(result.mdEmail.endsWith('@jaraaglobal.com')).toBe(true);
    expect(result.memberEmail.endsWith('@jaraaglobal.com')).toBe(true);
  });
});
