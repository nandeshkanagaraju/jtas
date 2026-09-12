/**
 * Route-handler guard for the rate limiter. Kept out of the handlers so the
 * policy constants are applied identically on every auth endpoint.
 */
import { AUTH_RATE_LIMIT, rateLimiter } from '@/lib/auth/rate-limit';
import { rateLimited } from '@/lib/errors';
import { clientIp } from '@/lib/utils/request';

/**
 * Applies the per-IP auth limit (SDD section 8.7: 10 requests/minute/IP).
 *
 * @throws {AppError} `RATE_LIMITED` with a `Retry-After` header.
 */
export async function guardAuthRate(request: Request): Promise<string> {
  const ip = clientIp(request);

  const result = await rateLimiter.hit(
    `auth:${ip}`,
    AUTH_RATE_LIMIT.limit,
    AUTH_RATE_LIMIT.windowSeconds,
  );

  if (!result.allowed) {
    throw rateLimited(
      'Too many attempts. Please wait a moment and try again.',
      result.retryAfterSeconds,
    );
  }

  return ip;
}
