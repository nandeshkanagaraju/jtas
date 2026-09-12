/**
 * Facts about the incoming request that services need but must not extract
 * themselves — keeping this here means a service stays a pure function of its
 * inputs and remains testable without a `Request`.
 */

/**
 * Best-effort client IP for the audit log and the rate limiter.
 *
 * Behind the Caddy reverse proxy (SDD section 10.2) the real address arrives in
 * `X-Forwarded-For`, whose first entry is the client and the rest are proxies.
 * The header is client-controllable when the app is exposed directly, so this
 * value is good enough to record and to throttle on, and is never used for an
 * authorisation decision.
 */
export function clientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }

  return request.headers.get('x-real-ip')?.trim() || 'unknown';
}

/** A short, non-identifying description of the client, for audit context. */
export function userAgent(request: Request): string | null {
  return request.headers.get('user-agent')?.slice(0, 255) ?? null;
}
