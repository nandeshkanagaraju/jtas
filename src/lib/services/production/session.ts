/**
 * The production gate for a route that has already called
 * `requireActiveSession()`: anyone who may see the production pages at all.
 * Finer decisions are made in the service.
 */
import type { SessionUser } from '@/lib/auth/session';
import { forbidden } from '@/lib/errors';

import { canSeeProduction } from './access';

export function assertProductionUser(user: SessionUser): SessionUser {
  if (!canSeeProduction(user)) {
    throw forbidden('Production reports are for the supervisors, Planning and the MD.');
  }
  return user;
}
