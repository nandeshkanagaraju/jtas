/**
 * Content Security Policy (SDD section 8.8).
 *
 * Built per request in middleware rather than statically in `next.config.ts`,
 * because it has to carry a fresh nonce.
 *
 * Why a nonce at all: the App Router streams its RSC payload through inline
 * `<script>` tags. A flat `script-src 'self'` blocks those, and the result is
 * the worst kind of failure — the page server-renders and looks correct, but
 * React never hydrates, so nothing on it responds to a click. A static policy
 * therefore has to choose between `'unsafe-inline'`, which defeats the point of
 * having a CSP, and a nonce. This is the nonce.
 *
 * Next.js picks the value up automatically: when the *request* carries a
 * `Content-Security-Policy` header containing a nonce, it stamps that nonce on
 * every script tag it emits.
 *
 * `'strict-dynamic'` lets those trusted scripts load the chunks they need
 * without every chunk URL having to be enumerated, and makes the `'self'`
 * fallback irrelevant in supporting browsers.
 */

/** A fresh 128-bit nonce, base64 as the CSP grammar requires. */
export function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

/**
 * Assembles the policy.
 *
 * Development adds `'unsafe-eval'`, which the Next dev server's hot reloader
 * needs and production must never have.
 */
export function buildContentSecurityPolicy(nonce: string): string {
  const isDevelopment = process.env.NODE_ENV !== 'production';

  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDevelopment ? " 'unsafe-eval'" : ''}`,
    // Next injects critical CSS inline and Tailwind v4 emits inline custom
    // properties, neither of which carries a nonce. Style injection is a far
    // weaker primitive than script injection, so this is the accepted trade.
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    "img-src 'self' data: blob:",
    "connect-src 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "object-src 'none'",
    // Belt and braces with the HSTS header: no plain-HTTP subresources.
    ...(isDevelopment ? [] : ['upgrade-insecure-requests']),
  ].join('; ');
}
