import type { NextConfig } from 'next';

/**
 * Security headers (SDD section 8.8). `frame-ancestors 'none'` and
 * `X-Frame-Options` together stop JTAS being framed, which matters because the
 * session lives in a `SameSite=Lax` cookie.
 *
 * The CSP allows `'unsafe-inline'` for styles only: Next injects critical CSS
 * inline, and Tailwind v4 emits inline custom properties. Scripts are not
 * granted it — `'strict-dynamic'` would be the next step once a nonce pipeline
 * is in place, noted in docs/DEFERRED.md.
 */
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  // Next's runtime needs eval in development only.
  process.env.NODE_ENV === 'production'
    ? "script-src 'self'"
    : "script-src 'self' 'unsafe-eval' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "object-src 'none'",
].join('; ');

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
          { key: 'Content-Security-Policy', value: CONTENT_SECURITY_POLICY },
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
