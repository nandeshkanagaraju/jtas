/**
 * The startup check that refuses to boot when Brevo would rewrite the sender.
 *
 * Written after the failure it prevents. `MAIL_FROM` was a verified, active
 * Brevo sender on `gmail.com`; Brevo sent as
 * `nandeshjeyalakshmi@12289361.brevosend.com` and Gmail dropped it silently.
 * Every layer reported success — 201 from the API, row SENT, "Sent" in Brevo's
 * log, credits charged — and only the log's From column showed it.
 *
 * Two properties matter and both are load-bearing:
 *
 *   an unauthenticated From domain must STOP the boot, loudly and specifically;
 *   nothing may stop a developer working offline against Mailpit.
 */
import { describe, expect, it, vi } from 'vitest';

import {
  checkBrevoSenderDomain,
  domainOf,
  SENDERS_DOMAINS_ENDPOINT,
} from '@/lib/startup/brevo-sender';

const BREVO_ENV = {
  NODE_ENV: 'test',
  MAIL_PROVIDER: 'brevo',
  BREVO_API_KEY: 'test-key',
  MAIL_FROM: 'notifications@jaraaglobal.com',
} as NodeJS.ProcessEnv;

describe('domainOf', () => {
  it.each([
    ['a@b.com', 'b.com'],
    ['JTAS <a@B.COM>', 'b.com'],
    ['  a@b.com  ', 'b.com'],
    ['"Name, Ltd" <a@b.com>', 'b.com'],
    ['not-an-address', ''],
  ])('%s -> %s', (input, expected) => {
    expect(domainOf(input)).toBe(expected);
  });
});

describe('MAIL_PROVIDER=smtp — local development must be untouched', () => {
  it('returns ok and makes NO network call at all', async () => {
    const fetchDomains = vi.fn();

    const result = await checkBrevoSenderDomain(
      { NODE_ENV: 'test', MAIL_PROVIDER: 'smtp' } as NodeJS.ProcessEnv,
      fetchDomains,
    );

    expect(result.severity).toBe('ok');
    expect(fetchDomains).not.toHaveBeenCalled();
  });

  it('treats an unset MAIL_PROVIDER as smtp, and still calls nothing', async () => {
    const fetchDomains = vi.fn();

    const result = await checkBrevoSenderDomain(
      { NODE_ENV: 'test' } as NodeJS.ProcessEnv,
      fetchDomains,
    );

    expect(result.severity).toBe('ok');
    expect(fetchDomains).not.toHaveBeenCalled();
  });

  it('does not care that MAIL_FROM is a freemail address under smtp', async () => {
    const fetchDomains = vi.fn();

    const result = await checkBrevoSenderDomain(
      {
        NODE_ENV: 'test',
        MAIL_PROVIDER: 'smtp',
        MAIL_FROM: 'anything@gmail.com',
      } as NodeJS.ProcessEnv,
      fetchDomains,
    );

    expect(result.severity).toBe('ok');
    expect(fetchDomains).not.toHaveBeenCalled();
  });
});

describe('MAIL_PROVIDER=brevo — an unauthenticated domain stops the boot', () => {
  it('refuses when the authenticated list is empty', async () => {
    const result = await checkBrevoSenderDomain(BREVO_ENV, async () => []);

    expect(result.severity).toBe('error');
    expect(result.message).toContain('jaraaglobal.com');
    expect(result.message).toContain('EMPTY');
  });

  it('refuses when the domain is absent from a populated list', async () => {
    const result = await checkBrevoSenderDomain(BREVO_ENV, async () => ['otherdomain.com']);

    expect(result.severity).toBe('error');
    expect(result.message).toContain('otherdomain.com');
  });

  /** The exact case that happened. */
  it('refuses a verified gmail.com sender, and says why it can never work', async () => {
    const result = await checkBrevoSenderDomain(
      { ...BREVO_ENV, MAIL_FROM: 'nandeshjeyalakshmi@gmail.com' },
      async () => [],
    );

    expect(result.severity).toBe('error');
    expect(result.message).toContain('gmail.com');
    expect(result.message).toContain('brevosend.com');
    expect(result.message).toMatch(/never be authenticated/i);
  });

  /**
   * Condition 1: the message must be specific enough to act on without
   * already knowing the answer.
   */
  it('names the domain, the list, and the exact curl to see it', async () => {
    const result = await checkBrevoSenderDomain(BREVO_ENV, async () => []);

    expect(result.message).toContain('MAIL_FROM');
    expect(result.message).toContain('jaraaglobal.com');
    expect(result.message).toContain(SENDERS_DOMAINS_ENDPOINT);
    expect(result.message).toContain('curl');
    expect(result.message).toContain('api-key');
    // The escape hatch for someone who just wants to work locally.
    expect(result.message).toContain('MAIL_PROVIDER=smtp');
    // Not a generic "mail misconfigured".
    expect(result.message.length).toBeGreaterThan(200);
  });

  it('refuses when BREVO_API_KEY is missing', async () => {
    const fetchDomains = vi.fn();

    const result = await checkBrevoSenderDomain({ ...BREVO_ENV, BREVO_API_KEY: '' }, fetchDomains);

    expect(result.severity).toBe('error');
    expect(result.message).toContain('BREVO_API_KEY');
    expect(fetchDomains).not.toHaveBeenCalled();
  });

  it('refuses a MAIL_FROM with no domain', async () => {
    const result = await checkBrevoSenderDomain(
      { ...BREVO_ENV, MAIL_FROM: 'not-an-address' },
      async () => ['jaraaglobal.com'],
    );

    expect(result.severity).toBe('error');
    expect(result.message).toContain('no domain');
  });
});

describe('MAIL_PROVIDER=brevo — an authenticated domain boots', () => {
  it('passes when the domain is on the list', async () => {
    const result = await checkBrevoSenderDomain(BREVO_ENV, async () => ['jaraaglobal.com']);

    expect(result.severity).toBe('ok');
    expect(result.message).toContain('jaraaglobal.com');
  });

  it('passes on the "Name <address>" form', async () => {
    const result = await checkBrevoSenderDomain(
      { ...BREVO_ENV, MAIL_FROM: 'JTAS <notifications@JaraaGlobal.com>' },
      async () => ['jaraaglobal.com'],
    );

    expect(result.severity).toBe('ok');
  });

  it('passes when the domain is one of several', async () => {
    const result = await checkBrevoSenderDomain(BREVO_ENV, async () => [
      'other.com',
      'jaraaglobal.com',
    ]);

    expect(result.severity).toBe('ok');
  });
});

describe('an unreachable Brevo warns but boots', () => {
  /**
   * Condition 2: being unable to ask is not evidence of misconfiguration, and
   * a laptop on a train must still start the worker. `null` is the "could not
   * ask" answer and is deliberately distinct from `[]`, which is a real answer
   * meaning no domain is authenticated.
   */
  it('warns rather than failing when the API cannot be reached', async () => {
    const result = await checkBrevoSenderDomain(BREVO_ENV, async () => null);

    expect(result.severity).toBe('warning');
    expect(result.message).toMatch(/could not reach brevo/i);
    expect(result.message).toContain(SENDERS_DOMAINS_ENDPOINT);
  });

  it('distinguishes "could not ask" from "nothing is authenticated"', async () => {
    const unreachable = await checkBrevoSenderDomain(BREVO_ENV, async () => null);
    const empty = await checkBrevoSenderDomain(BREVO_ENV, async () => []);

    expect(unreachable.severity).toBe('warning');
    expect(empty.severity).toBe('error');
  });

  it('never throws, whatever the lookup does', async () => {
    const result = await checkBrevoSenderDomain(BREVO_ENV, async () => {
      throw new Error('socket hang up');
    }).catch((error: unknown) => error);

    // A throw from the lookup must not become a crash at boot.
    expect(result).not.toBeInstanceOf(Error);
  });
});
