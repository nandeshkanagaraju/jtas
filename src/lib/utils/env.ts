/**
 * Server-side environment validation.
 *
 * Parsed lazily on first access rather than at import time, so that build-time
 * module evaluation (and unit tests that never touch the database) do not need
 * a fully populated environment.
 *
 * Importing this module from client code is a bug — it would leak secrets into
 * the browser bundle. The `server-only` guard is deliberately not used here
 * because the worker process imports it outside a Next.js context; the rule is
 * enforced by review and by these values never being referenced in a
 * `'use client'` file.
 */
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url().default('redis://localhost:6379'),

  // 32 characters is the floor for an HS256 secret worth having.
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  REFRESH_SECRET: z.string().min(32, 'REFRESH_SECRET must be at least 32 characters'),

  APP_BASE_URL: z.string().url().default('http://localhost:3000'),

  SMTP_HOST: z.string().default('localhost'),
  SMTP_PORT: z.coerce.number().int().positive().default(1025),
  SMTP_SECURE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  MAIL_FROM: z.string().default('JTAS <jtas@jaraaglobal.com>'),

  S3_ENDPOINT: z.string().optional(),
  /**
   * The endpoint a browser uses, when it differs from the one the server uses.
   *
   * In the production compose the app reaches MinIO on the Docker network and
   * the browser reaches it through Caddy, so presigned URLs must be signed
   * against the public name. Left unset, both are S3_ENDPOINT.
   */
  S3_PUBLIC_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().default('ap-south-1'),
  S3_BUCKET: z.string().optional(),
  S3_KEY: z.string().optional(),
  S3_SECRET: z.string().optional(),

  SENTRY_DSN: z.string().optional(),
  LOG_LEVEL: z.string().default('info'),

  SCHEDULER_INTERVAL_MINUTES: z.coerce.number().int().positive().default(5),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

/**
 * Returns the validated environment, throwing a readable aggregate error the
 * first time anything is missing or malformed.
 */
export function env(): Env {
  if (cached) return cached;

  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(
      `Invalid environment configuration:\n${problems}\n\nSee .env.example for every required key.`,
    );
  }

  cached = parsed.data;
  return cached;
}

/** Test seam: forces the next `env()` call to re-read `process.env`. */
export function resetEnvCache(): void {
  cached = undefined;
}
