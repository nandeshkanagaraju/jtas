/**
 * Request rate limiting (SDD section 8.7).
 *
 * Behind an interface so the in-memory implementation can be swapped for a
 * Redis one without touching a route handler. In-memory is correct for a
 * single app process; the moment JTAS runs more than one, the limit becomes
 * per-process and the Redis implementation is required.
 */

export interface RateLimitResult {
  allowed: boolean;
  /** Requests still available in the current window. */
  remaining: number;
  /** Seconds until the window resets. */
  retryAfterSeconds: number;
}

export interface RateLimiter {
  /**
   * Records one hit against `key` and reports whether it is allowed.
   *
   * @param key    Bucket identity, e.g. `auth:203.0.113.7`.
   * @param limit  Maximum hits per window.
   * @param windowSeconds Window length.
   */
  hit(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult>;
  /** Clears a bucket, e.g. after a successful login. */
  reset(key: string): Promise<void>;
}

interface Bucket {
  count: number;
  /** Epoch milliseconds at which this window ends. */
  resetAt: number;
}

/**
 * Fixed-window counter.
 *
 * A fixed window lets up to 2× the limit through across a window boundary. For
 * a login throttle protecting an account that also has a 5-attempt lockout,
 * that is an acceptable trade for keeping the implementation obvious.
 */
export class InMemoryRateLimiter implements RateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  /** Sweep threshold: prune expired buckets once the map grows past this. */
  private static readonly SWEEP_AFTER_ENTRIES = 1_000;

  async hit(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult> {
    const now = Date.now();
    const existing = this.buckets.get(key);

    if (!existing || existing.resetAt <= now) {
      this.buckets.set(key, { count: 1, resetAt: now + windowSeconds * 1000 });
      this.maybeSweep(now);
      return { allowed: true, remaining: limit - 1, retryAfterSeconds: windowSeconds };
    }

    existing.count += 1;
    const retryAfterSeconds = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));

    return {
      allowed: existing.count <= limit,
      remaining: Math.max(0, limit - existing.count),
      retryAfterSeconds,
    };
  }

  async reset(key: string): Promise<void> {
    this.buckets.delete(key);
  }

  /** Test seam. */
  clear(): void {
    this.buckets.clear();
  }

  /**
   * Drops expired buckets so an unbounded stream of distinct IPs cannot grow
   * the map without limit.
   */
  private maybeSweep(now: number): void {
    if (this.buckets.size < InMemoryRateLimiter.SWEEP_AFTER_ENTRIES) return;
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) this.buckets.delete(key);
    }
  }
}

/**
 * Process-wide limiter, cached on `globalThis` so hot reload does not reset the
 * counters mid-development.
 */
const globalForLimiter = globalThis as unknown as { jtasRateLimiter?: InMemoryRateLimiter };

export const rateLimiter: RateLimiter =
  globalForLimiter.jtasRateLimiter ??
  (globalForLimiter.jtasRateLimiter = new InMemoryRateLimiter());

// --- Policy constants ------------------------------------------------------

/** SDD section 8.7: 10 login attempts per minute per IP. */
export const AUTH_RATE_LIMIT = { limit: 10, windowSeconds: 60 } as const;

/** SDD section 8.7: 100 writes per minute per user. Applied from M3 onwards. */
export const WRITE_RATE_LIMIT = { limit: 100, windowSeconds: 60 } as const;
