/**
 * Audit trail (architecture rule 5, SDD section 8.10, FR-73).
 *
 * Accountability is the product, so the log has to be provable: every
 * state-changing operation writes its row inside the *same transaction* as the
 * change. A separate write could succeed while the change rolls back, or the
 * reverse, and either leaves the record arguable.
 *
 * That is why `writeAudit` takes a transaction client instead of reaching for
 * the singleton: the caller must already be inside `prisma.$transaction`.
 */
import type { Prisma } from '@prisma/client';

import type { Db } from '@/lib/db/prisma';

/**
 * Audit actions. A union rather than a free string so that a typo produces a
 * compile error instead of a row nobody will ever find again.
 */
export type AuditAction =
  // M1 — authentication
  | 'LOGIN_SUCCESS'
  | 'LOGIN_FAILED'
  | 'LOGOUT'
  | 'PASSWORD_CHANGED'
  | 'ACCOUNT_LOCKED'
  | 'TOKEN_REFRESHED'
  | 'TOKEN_REUSE_DETECTED'
  // Later modules extend this union as they land.
  | 'USER_CREATED'
  | 'USER_UPDATED'
  | 'USER_DEACTIVATED'
  | 'USER_REASSIGNED'
  | 'PASSWORD_RESET'
  // M3 — jobs
  | 'JOB_CREATED'
  | 'JOB_UPDATED'
  | 'JOB_PUBLISHED'
  | 'JOB_HELD'
  | 'JOB_UNHELD'
  | 'JOB_CANCELLED'
  | 'JOB_STATUS_RECOMPUTED';

export type AuditEntityType = 'USER' | 'JOB' | 'SUBTASK' | 'PROBLEM' | 'SETTING' | 'SESSION';

export interface AuditInput {
  /** Null for a failed login, where the actor is not yet identified. */
  actorId: string | null;
  action: AuditAction;
  entityType: AuditEntityType;
  entityId: string;
  before?: Prisma.InputJsonValue;
  after?: Prisma.InputJsonValue;
  ipAddress?: string | null;
  /** Set when a DEPUTY_MD acts for the MD, so the record says so. */
  onBehalfOf?: string | null;
}

/**
 * Appends an audit row.
 *
 * @param db A transaction client. Pass the handle from `prisma.$transaction`,
 *           never the root client, so the row and the change commit together.
 */
export async function writeAudit(db: Db, input: AuditInput): Promise<void> {
  await db.auditLog.create({
    data: {
      actorId: input.actorId,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      before: input.before,
      after: input.after,
      ipAddress: input.ipAddress ?? null,
      onBehalfOf: input.onBehalfOf ?? null,
    },
  });
}

/**
 * Best-effort audit for paths that must not fail because logging failed.
 *
 * Used only for `LOGIN_FAILED`: the login route already denies access, and
 * letting an audit write turn that denial into a 500 would tell an attacker
 * more than the denial does. Every state-changing path uses {@link writeAudit}
 * inside its transaction instead.
 */
export async function tryWriteAudit(db: Db, input: AuditInput): Promise<void> {
  try {
    await writeAudit(db, input);
  } catch {
    // Intentionally swallowed — see the note above.
  }
}
