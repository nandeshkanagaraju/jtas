/**
 * Public surface of the user-administration service.
 *
 * Route handlers import from `@/lib/services/users` and never reach into a
 * file below it, so the internal split can change without touching the API.
 */
export { listUsers, getUser, findOpenSubtasks } from './queries';

export { createUser, updateUser, type CreatedUser } from './mutations';

export {
  deactivateUser,
  reactivateUser,
  resetPassword,
  type DeactivationResult,
  type PasswordResetResult,
} from './lifecycle';

export {
  redactUser,
  type Actor,
  type OpenSubtaskRef,
  type RequestContext,
  type UserSummary,
} from './types';
