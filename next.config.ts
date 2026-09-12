import type { NextConfig } from 'next';

/**
 * Static security headers (SDD section 8.8).
 *
 * The Content-Security-Policy is deliberately NOT here — it needs a per-request
 * nonce, so it is built in `src/lib/security/csp.ts` and applied by middleware.
 * A static `script-src 'self'` blocks the App Router's inline bootstrap scripts
 * and leaves every page rendered but unhydrated.
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,

  experimental: {
    /**
     * Enables `forbidden()` and `unauthorized()` from `next/navigation`, so a
     * page can answer with a real 403 rather than redirecting. Architecture
     * rule 3: a refusal should be visible as a refusal.
     */
    authInterrupts: true,
  },

  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=31536000; includeSubDomains',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
