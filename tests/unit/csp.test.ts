import { afterEach, describe, expect, it } from 'vitest';

import { buildContentSecurityPolicy, generateNonce } from '@/lib/security/csp';

const original = process.env.S3_ENDPOINT;

afterEach(() => {
  if (original === undefined) delete process.env.S3_ENDPOINT;
  else process.env.S3_ENDPOINT = original;
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
});
