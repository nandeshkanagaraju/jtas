/**
 * Structured logging (SDD section 1.1). Pino to stdout; the container runtime
 * collects it. Child loggers carry a `module` tag so worker output can be
 * separated from request output.
 *
 * The redaction list is the security control, not a nicety. SDD section 8 item
 * 9 keeps secrets in environment variables and out of the repository; this is
 * the other half — keeping them out of the log file, which is the copy that
 * gets shipped to an aggregator, attached to a support ticket and kept for
 * thirty days (SDD 10.4).
 */
import pino from 'pino';

/**
 * Keys whose value must never be written down.
 *
 * Listed both bare and one level deep, because pino's redaction is path-based
 * rather than recursive — `{ password }` and `{ body: { password } }` are two
 * different paths and only the listed ones are censored.
 */
const SECRET_KEYS = [
  'password',
  'newPassword',
  'currentPassword',
  'confirmPassword',
  'passwordHash',
  'temporaryPassword',
  'token',
  'accessToken',
  'refreshToken',
  'secret',
  'apiKey',
  // M9 lets an administrator set the SMTP password at runtime; M10 mints
  // presigned URLs that carry their own authorisation in the query string.
  'smtpPassword',
  'mail.smtp_password',
  'uploadUrl',
  'url',
  'signedUrl',
  'S3_SECRET',
  'S3_KEY',
  'SMTP_PASS',
  'JWT_SECRET',
  'REFRESH_SECRET',
  'DATABASE_URL',
];

const paths = [
  ...SECRET_KEYS,
  ...SECRET_KEYS.map((key) => `*.${key}`),
  ...SECRET_KEYS.map((key) => `*.*.${key}`),
  'req.headers.authorization',
  'req.headers.cookie',
  'headers.authorization',
  'headers.cookie',
  // A validation failure echoes the field that failed; the body it came from
  // must not ride along with it.
  'body',
  'requestBody',
  '*.body',
];

/**
 * The logger's options, exported so a test can build a probe logger with the
 * *same* redaction list writing to an in-memory stream. Asserting against a
 * copied list would test the copy.
 */
export const loggerOptions: pino.LoggerOptions = {
  level: process.env.LOG_LEVEL ?? 'info',
  base: undefined,
  redact: { paths, censor: '[redacted]' },
  timestamp: pino.stdTimeFunctions.isoTime,
};

export const logger = pino(loggerOptions);

export function moduleLogger(module: string) {
  return logger.child({ module });
}

/**
 * A logger bound to one request (build spec M11.4).
 *
 * Every line from one request carries the same `requestId`, so a 500 in the
 * aggregator can be joined to the authorisation check and the query that
 * preceded it. Without it, a busy afternoon's log is interleaved lines from
 * forty requests and the only way to read it is by timestamp.
 */
export function requestLogger(module: string, requestId: string) {
  return logger.child({ module, requestId });
}

/** The header a reverse proxy sets, and the one JTAS echoes back. */
export const REQUEST_ID_HEADER = 'x-request-id';

/**
 * The id for this request: the proxy's if it set one, otherwise a fresh one.
 *
 * Taking Caddy's value when present is what lets a line in the access log and a
 * line in the application log be joined — the same request has one id from the
 * edge inward.
 */
export function requestIdFrom(headers: Headers): string {
  const supplied = headers.get(REQUEST_ID_HEADER);

  // Bounded and character-checked: the value reaches a log line and a response
  // header, and neither should carry arbitrary input.
  if (supplied && /^[A-Za-z0-9._-]{1,64}$/.test(supplied)) return supplied;

  return crypto.randomUUID();
}
