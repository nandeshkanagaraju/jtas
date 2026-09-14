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
 * The object-storage origin, so uploads and thumbnails are not blocked.
 *
 * M10 sends files straight from the browser to the bucket through a presigned
 * PUT and reads image previews back through a presigned GET. Both are
 * cross-origin, so `connect-src 'self'` blocks the upload and `img-src 'self'`
 * blocks the thumbnail — silently, as a console warning, which is how this was
 * found only when a real file was dragged in.
 *
 * Derived from `S3_ENDPOINT` rather than hard-coded: the origin differs between
 * the local MinIO and whatever the production bucket is, and a wildcard would
 * give back most of what the policy is for.
 */
function storageOrigin(): string {
  // The public endpoint when the two differ, because this directive governs
  // what the *browser* is allowed to reach.
  const endpoint = process.env.S3_PUBLIC_ENDPOINT || process.env.S3_ENDPOINT;
  if (!endpoint) return '';

  try {
    return new URL(endpoint).origin;
  } catch {
    return '';
  }
}

/**
 * Assembles the policy.
 *
 * Development adds `'unsafe-eval'`, which the Next dev server's hot reloader
 * needs and production must never have.
 */
export function buildContentSecurityPolicy(nonce: string): string {
  const isDevelopment = process.env.NODE_ENV !== 'production';
  const storage = storageOrigin();

  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDevelopment ? " 'unsafe-eval'" : ''}`,
    // Next injects critical CSS inline and Tailwind v4 emits inline custom
    // properties, neither of which carries a nonce. Style injection is a far
    // weaker primitive than script injection, so this is the accepted trade.
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    `img-src 'self' data: blob:${storage ? ` ${storage}` : ''}`,
    `connect-src 'self'${storage ? ` ${storage}` : ''}`,
    "form-action 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "object-src 'none'",
    // Belt and braces with the HSTS header: no plain-HTTP subresources.
    ...(isDevelopment ? [] : ['upgrade-insecure-requests']),
  ].join('; ');
}
