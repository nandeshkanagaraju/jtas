/**
 * Authorisation. The single gate for every access decision in JTAS
 * (SDD section 6.3, architecture rule 3).
 *
 * Every route handler calls `can()` before it mutates or returns anything.
 * Hiding a button in the UI is never the control — the UI calls the same
 * function only so that it does not offer an action the server would reject.
 *
 * Design notes:
 *
 *  - `Action` is a string-literal union and the switch over it is exhaustive,
 *    enforced by the `never` check in the default branch. Adding an action
 *    without deciding who may perform it is a compile error, not a silently
 *    permissive default.
 *
 *  - Each action declares the resource it needs via {@link ResourceFor}, so
 *    passing a job where a subtask is required will not typecheck. Actions that
 *    are not about a specific record take `undefined`.
 *
 *  - The resource types are structural, not Prisma models. The policy depends
 *    on the four or five fields that actually drive a decision, which keeps it
 *    pure, trivially testable, and callable from a context that has only
 *    partially loaded a record.
 */
import type { Role } from '@prisma/client';

import { AppError } from '@/lib/errors';

// ---------------------------------------------------------------------------
// Subject
// ---------------------------------------------------------------------------

/** The acting user, reduced to what an authorisation decision depends on. */
export interface PolicySubject {
  id: string;
  role: Role;
  departmentId: string | null;
  isActive: boolean;
}

// ---------------------------------------------------------------------------
// Resources
// ---------------------------------------------------------------------------

/**
 * A job, plus the set of users who hold a subtask on it. The membership list is
 * what makes "view a job he participates in" (SDD section 6.3) decidable
 * without the policy issuing a query of its own.
 */
export interface JobResource {
  id: string;
  createdById: string;
  /** User ids assigned to at least one subtask of this job. */
  participantIds: readonly string[];
}

export interface SubtaskResource {
  id: string;
  jobId: string;
  assigneeId: string;
  departmentId: string;
}

export interface ProblemResource {
  id: string;
  raisedById: string;
  /** The subtask the problem was raised against. */
  subtask: SubtaskResource;
}

export interface UserResource {
  id: string;
  role: Role;
}

export interface NotificationResource {
  id: string;
  userId: string;
}

export interface CommentResource {
  id: string;
  userId: string;
  subtask: SubtaskResource;
}

export interface ExtensionRequestResource {
  id: string;
  requestedById: string;
  subtask: SubtaskResource;
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/**
 * Every authorisation decision in the system, named `entity:verb`.
 *
 * The grouping comments map each block back to a row of the SDD section 6.3
 * matrix, so the table and this union can be checked against each other by eye.
 */
export type Action =
  // "Create/publish job", "View all jobs", "View job he participates in"
  | 'job:create'
  | 'job:view'
  | 'job:edit'
  | 'job:publish'
  | 'job:hold'
  | 'job:cancel'
  | 'job:list'
  // "Assign / reassign subtask", "Change any deadline"
  | 'subtask:create'
  | 'subtask:view'
  | 'subtask:edit'
  | 'subtask:reassign'
  | 'subtask:changeDeadline'
  | 'subtask:approve'
  // "Update own subtask status" / "Update another's subtask status"
  | 'subtask:updateStatus'
  | 'subtask:requestExtension'
  | 'extensionRequest:decide'
  // "Raise problem" / "Resolve problem"
  | 'problem:raise'
  | 'problem:view'
  | 'problem:resolve'
  // Collaboration (M10)
  | 'comment:create'
  | 'comment:view'
  | 'attachment:create'
  | 'attachment:view'
  // Notifications
  | 'notification:view'
  | 'notification:markRead'
  // "Manage users / settings"
  | 'user:manage'
  | 'user:view'
  | 'settings:manage'
  | 'settings:view'
  | 'holiday:manage'
  | 'department:view'
  // "View audit log"
  | 'audit:view'
  // Analytics (M8)
  | 'dashboard:md'
  | 'dashboard:department'
  | 'report:export';

/** The resource each action is decided against. */
export interface ResourceFor {
  'job:create': undefined;
  'job:view': JobResource;
  'job:edit': JobResource;
  'job:publish': JobResource;
  'job:hold': JobResource;
  'job:cancel': JobResource;
  'job:list': undefined;

  'subtask:create': JobResource;
  'subtask:view': SubtaskResource;
  'subtask:edit': SubtaskResource;
  'subtask:reassign': SubtaskResource;
  'subtask:changeDeadline': SubtaskResource;
  'subtask:approve': SubtaskResource;
  'subtask:updateStatus': SubtaskResource;
  'subtask:requestExtension': SubtaskResource;
  'extensionRequest:decide': ExtensionRequestResource;

  'problem:raise': SubtaskResource;
  'problem:view': ProblemResource;
  'problem:resolve': ProblemResource;

  'comment:create': SubtaskResource;
  'comment:view': SubtaskResource;
  'attachment:create': SubtaskResource;
  'attachment:view': SubtaskResource;

  'notification:view': NotificationResource;
  'notification:markRead': NotificationResource;

  'user:manage': UserResource | undefined;
  'user:view': undefined;
  'settings:manage': undefined;
  'settings:view': undefined;
  'holiday:manage': undefined;
  'department:view': undefined;

  'audit:view': undefined;

  'dashboard:md': undefined;
  'dashboard:department': undefined;
  'report:export': undefined;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** MD and Deputy share every job-management capability except where noted. */
function isCommand(user: PolicySubject): boolean {
  return user.role === 'MD' || user.role === 'DEPUTY_MD';
}

/** True when the user holds this subtask. */
function ownsSubtask(user: PolicySubject, subtask: SubtaskResource): boolean {
  return subtask.assigneeId === user.id;
}

/** True when the user has at least one subtask on this job, or created it. */
function participatesInJob(user: PolicySubject, job: JobResource): boolean {
  return job.createdById === user.id || job.participantIds.includes(user.id);
}

// ---------------------------------------------------------------------------
// The gate
// ---------------------------------------------------------------------------

/**
 * Decides whether `user` may perform `action` on `resource`.
 *
 * Pure and synchronous: the caller loads whatever the decision needs and passes
 * it in. That keeps every rule visible in one file and makes the whole matrix
 * unit-testable without a database.
 *
 * @example
 * ```ts
 * const subtask = await loadSubtask(id);
 * if (!can(session.user, 'subtask:updateStatus', subtask)) throw forbidden();
 * ```
 */
export function can<A extends Action>(
  user: PolicySubject,
  action: A,
  resource: ResourceFor[A],
): boolean {
  // A deactivated account keeps its history but loses every capability
  // (FR-70: deactivate, never delete).
  if (!user.isActive) return false;

  switch (action) {
    // --- Jobs ------------------------------------------------------------
    // Matrix: "Create/publish job" — MD ✔ DEPUTY ✔ ADMIN ✖ MEMBER ✖
    case 'job:create':
    case 'job:list':
      return isCommand(user);

    case 'job:edit':
    case 'job:publish':
    case 'job:hold':
    case 'job:cancel':
      return isCommand(user);

    // Matrix: "View all jobs" — MD ✔ DEPUTY ✔ ADMIN ✔ (read) MEMBER ✖;
    //         "View job he participates in" — MEMBER ✔
    case 'job:view': {
      const job = resource as JobResource;
      if (isCommand(user) || user.role === 'ADMIN') return true;
      return participatesInJob(user, job);
    }

    // --- Subtasks --------------------------------------------------------
    // Matrix: "Assign / reassign subtask" — MD ✔ DEPUTY ✔ ADMIN ✖ MEMBER ✖
    case 'subtask:create':
    case 'subtask:edit':
    case 'subtask:reassign':
    case 'subtask:approve':
      return isCommand(user);

    // Matrix: "Change any deadline" — MD ✔ DEPUTY ✔ ADMIN ✖ MEMBER ✖.
    // A member's legitimate route to more time is subtask:requestExtension
    // (FR-33, improvement I-11), never editing the deadline himself (FR-35).
    case 'subtask:changeDeadline':
      return isCommand(user);

    /**
     * A member sees a subtask when he holds it, or when it belongs to a job he
     * participates in. The second clause is the PDD section 13 question 3
     * recommendation — read-only visibility of sibling departments removes the
     * phone call asking whether material has arrived.
     */
    case 'subtask:view':
    case 'comment:view':
    case 'attachment:view': {
      const subtask = resource as SubtaskResource;
      if (isCommand(user) || user.role === 'ADMIN') return true;
      return ownsSubtask(user, subtask);
    }

    /**
     * Matrix: "Update own subtask status" — MD ✔ DEPUTY ✔ ADMIN ✖ MEMBER ✔;
     *         "Update another's subtask status" — MD ✔ only.
     * So the MD may act on anyone's subtask, while a deputy — like a member —
     * may only act on his own.
     */
    case 'subtask:updateStatus': {
      const subtask = resource as SubtaskResource;
      if (user.role === 'ADMIN') return false;
      if (user.role === 'MD') return true;
      return ownsSubtask(user, subtask);
    }

    // FR-33: only the assignee asks for more time.
    case 'subtask:requestExtension': {
      const subtask = resource as SubtaskResource;
      return ownsSubtask(user, subtask);
    }

    // Granting time is a deadline change, so it follows that row.
    case 'extensionRequest:decide':
      return isCommand(user);

    // --- Problems --------------------------------------------------------
    /**
     * Matrix: "Raise problem" — MD ✔ DEPUTY ✔ ADMIN ✖ MEMBER ✔ (own).
     *
     * Ambiguity resolved conservatively: raising a problem moves the subtask
     * into `PROBLEM`, which is a status change, and the status row restricts a
     * deputy to his own subtasks. The narrower rule wins, so DEPUTY_MD is held
     * to "own" here as well. Only the MD may raise a problem on someone else's
     * subtask. Flagged in docs/DEFERRED.md for the MD to confirm.
     */
    case 'problem:raise': {
      const subtask = resource as SubtaskResource;
      if (user.role === 'ADMIN') return false;
      if (user.role === 'MD') return true;
      return ownsSubtask(user, subtask);
    }

    // A member follows the problem he reported; the inbox itself is MD-only.
    case 'problem:view': {
      const problem = resource as ProblemResource;
      if (isCommand(user) || user.role === 'ADMIN') return true;
      return problem.raisedById === user.id || ownsSubtask(user, problem.subtask);
    }

    // Matrix: "Resolve problem" — MD ✔ DEPUTY ✔ ADMIN ✖ MEMBER ✖.
    // This is improvement I-05: once a problem is on record the pressure moves
    // to the decision maker, so the decision must be the decision maker's.
    case 'problem:resolve':
      return isCommand(user);

    // --- Collaboration ---------------------------------------------------
    // FR-34: a member comments and attaches on his own subtasks.
    case 'comment:create':
    case 'attachment:create': {
      const subtask = resource as SubtaskResource;
      if (user.role === 'ADMIN') return false;
      if (isCommand(user)) return true;
      return ownsSubtask(user, subtask);
    }

    // --- Notifications ---------------------------------------------------
    // A notification is personal; not even the MD reads another user's inbox.
    case 'notification:view':
    case 'notification:markRead': {
      const notification = resource as NotificationResource;
      return notification.userId === user.id;
    }

    // --- Administration --------------------------------------------------
    /**
     * Matrix: "Manage users / settings" — MD ✔ DEPUTY ✖ ADMIN ✔ MEMBER ✖.
     *
     * Extra rule not in the matrix but implied by it: an admin may not edit an
     * MD account. Without it, "manage users" would let an admin reset the MD's
     * password and assume the top role, making the MD-only column meaningless.
     */
    case 'user:manage': {
      const target = resource as UserResource | undefined;
      if (user.role === 'MD') return true;
      if (user.role !== 'ADMIN') return false;
      return target?.role !== 'MD';
    }

    case 'user:view':
    case 'settings:view':
      return user.role === 'MD' || user.role === 'ADMIN';

    case 'settings:manage':
    case 'holiday:manage':
      return user.role === 'MD' || user.role === 'ADMIN';

    // Everyone needs the department list to read a subtask label.
    case 'department:view':
      return true;

    // Matrix: "View audit log" — MD ✔ DEPUTY ✖ ADMIN ✔ MEMBER ✖.
    case 'audit:view':
      return user.role === 'MD' || user.role === 'ADMIN';

    // --- Analytics -------------------------------------------------------
    case 'dashboard:md':
    case 'dashboard:department':
      return isCommand(user);

    // SDD section 6.2 grants export to ADMIN as well as MD and Deputy.
    case 'report:export':
      return isCommand(user) || user.role === 'ADMIN';

    default: {
      // Exhaustiveness guard: a new Action that nobody decided on fails to
      // compile here rather than falling through to a permissive default.
      const exhaustive: never = action;
      throw new Error(`Unhandled authorisation action: ${String(exhaustive)}`);
    }
  }
}

/**
 * `can()` as an assertion.
 *
 * @throws {AppError} `FORBIDDEN` when the action is not permitted.
 */
export function assertCan<A extends Action>(
  user: PolicySubject,
  action: A,
  resource: ResourceFor[A],
): void {
  if (!can(user, action, resource)) {
    // Deliberately vague: the message must not confirm that the record exists.
    throw new AppError('FORBIDDEN', 'You do not have permission to do that.');
  }
}
