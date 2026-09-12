/**
 * Structured logging (SDD section 1.1). Pino to stdout; the container runtime
 * collects it. Child loggers carry a `module` tag so worker output can be
 * separated from request output.
 */
import pino from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  base: undefined,
  redact: {
    paths: [
      'password',
      'newPassword',
      'currentPassword',
      'passwordHash',
      'token',
      'refreshToken',
      '*.password',
      '*.passwordHash',
      'req.headers.authorization',
      'req.headers.cookie',
    ],
    censor: '[redacted]',
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});

export function moduleLogger(module: string) {
  return logger.child({ module });
}
