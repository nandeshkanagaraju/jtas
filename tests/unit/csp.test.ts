import { afterEach, describe, expect, it } from 'vitest';

import { buildContentSecurityPolicy, generateNonce } from '@/lib/security/csp';

/*
 * Every variable the policy reads, restored after each test — a leaked DSN or
 * endpoint makes these pass or fail depending on the order they ran in.
 */
const VARIABLES = [
  'S3_ENDPOINT',
  'S3_PUBLIC_ENDPOINT',
  'NEXT_PUBLIC_SENTRY_DSN',
  'APP_BASE_URL',
] as const;

const original = Object.fromEntries(VARIABLES.map((key) => [key, process.env[key]]));

afterEach(() => {
  for (const key of VARIABLES) {
    if (original[key] === undefined) delete process.env[key];
    else process.env[key] = original[key];
  }
});

/** Pulls one directive out of the assembled policy. */
function directive(policy: string, name: string): string {
  return (
    policy
      .split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${name} `)) ?? ''
  );
}

describe('generateNonce', () => {
  it('is base64 and different every time', () => {
    const a = generateNonce();
    const b = generateNonce();

    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9+/]+=*$/);
    expect(atob(a)).toHaveLength(16);
  });
});

describe('buildContentSecurityPolicy', () => {
  it('carries the nonce and strict-dynamic', () => {
    const policy = buildContentSecurityPolicy('abc123');

    expect(directive(policy, 'script-src')).toContain("'nonce-abc123'");
    expect(directive(policy, 'script-src')).toContain("'strict-dynamic'");
  });

  it('allows the storage origin to be reached and shown', () => {
    process.env.S3_ENDPOINT = 'http://localhost:9000';

    const policy = buildContentSecurityPolicy('n');

    /*
     * M10 uploads straight to the bucket and reads thumbnails back from it.
     * Without these the upload is blocked as a console warning and the page
     * merely looks broken — which is how this was found, by dragging in a real
     * file rather than by any test.
     */
    expect(directive(policy, 'connect-src')).toContain('http://localhost:9000');
    expect(directive(policy, 'img-src')).toContain('http://localhost:9000');
  });

  it('adds only the origin, never the path', () => {
    process.env.S3_ENDPOINT = 'https://s3.ap-south-1.amazonaws.com/some/path';

    const policy = buildContentSecurityPolicy('n');

    expect(directive(policy, 'connect-src')).toContain('https://s3.ap-south-1.amazonaws.com');
    expect(policy).not.toContain('/some/path');
  });

  it('stays closed when storage is not configured', () => {
    delete process.env.S3_ENDPOINT;

    const policy = buildContentSecurityPolicy('n');

    expect(directive(policy, 'connect-src')).toBe("connect-src 'self'");
  });

  it('ignores an unparseable endpoint rather than emitting a broken directive', () => {
    // A malformed value must not produce `connect-src 'self' not a url`, which
    // browsers treat as a syntax error and may drop the whole policy.
    process.env.S3_ENDPOINT = 'not a url';

    expect(directive(buildContentSecurityPolicy('n'), 'connect-src')).toBe("connect-src 'self'");
  });

  it('never widens the dangerous directives', () => {
    process.env.S3_ENDPOINT = 'http://localhost:9000';

    const policy = buildContentSecurityPolicy('n');

    // The bucket may be fetched from and displayed. It may not run code.
    expect(directive(policy, 'script-src')).not.toContain('localhost:9000');
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).toContain("base-uri 'self'");
  });

  it('lets the browser reach Sentry, and only Sentry', () => {
    process.env.NEXT_PUBLIC_SENTRY_DSN = 'https://abc123@o42.ingest.sentry.io/99';
    process.env.S3_ENDPOINT = 'http://localhost:9000';

    const policy = buildContentSecurityPolicy('n');

    // Without this the policy blocks the very request that reports the error,
    // and the only trace is a console warning nobody reads.
    expect(directive(policy, 'connect-src')).toBe(
      "connect-src 'self' http://localhost:9000 https://o42.ingest.sentry.io",
    );

    // Reporting is not running code or loading pictures.
    expect(directive(policy, 'script-src')).not.toContain('sentry.io');
    expect(directive(policy, 'img-src')).not.toContain('sentry.io');
  });

  it('adds nothing when Sentry is not configured', () => {
    delete process.env.NEXT_PUBLIC_SENTRY_DSN;

    expect(directive(buildContentSecurityPolicy('n'), 'connect-src')).toBe("connect-src 'self'");
  });

  it('upgrades insecure requests only when the app is actually served over TLS', () => {
    process.env.APP_BASE_URL = 'https://jtas.example.com';
    expect(buildContentSecurityPolicy('n')).toContain('upgrade-insecure-requests');
  });

  it('does not upgrade insecure requests when the app is served over plain http', () => {
    /*
     * The directive rewrites every subresource to https. Over plain http that
     * is a self-inflicted outage: the browser asks for
     * `https://localhost:3000/...`, nothing answers, and the page renders as
     * bare HTML with no stylesheet and no JavaScript. Chrome exempts localhost
     * and shows nothing wrong; Safari does not, which is how it was found.
     */
    process.env.APP_BASE_URL = 'http://localhost:3000';
    expect(buildContentSecurityPolicy('n')).not.toContain('upgrade-insecure-requests');
  });

  it('does not upgrade when there is no base URL to judge by', () => {
    delete process.env.APP_BASE_URL;
    expect(buildContentSecurityPolicy('n')).not.toContain('upgrade-insecure-requests');
  });
});
