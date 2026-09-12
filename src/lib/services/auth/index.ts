/**
 * Public surface of the authentication service.
 *
 * Route handlers import from `@/lib/services/auth` and never reach into a file
 * below it, so the internal split can change without touching the API.
 */
export { login, logout, LOCKOUT_MINUTES, MAX_FAILED_LOGINS } from './login';
export { rotateRefreshToken } from './tokens';
export { changePassword } from './password';
export type { AuthenticatedUser, LoginResult, RequestContext, SessionTokens } from './tokens';
export { ACCESS_TTL_SECONDS } from '@/lib/auth/jwt';
