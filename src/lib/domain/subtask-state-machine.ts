/**
 * The subtask state machine — SDD section 4.3.
 *
 * A pure module. No database, no clock, no imports beyond Prisma's enums. That
 * is deliberate and the build spec insists on it: this table is the core of the
 * product, it decides whether a member's tap is accepted, and if it were
 * embedded in a route handler it would be untestable and quietly wrong.
 *
 * Every transition in the SDD table is represented here, and the switch is
 * exhaustive over `SubtaskAction`, so adding an action without deciding its
 * rules is a compile error rather than a silent fall-through.
 *
 * `OVERDUE` is deliberately absent: it is a derived condition, not a status
 * (PDD improvement I-08), so a subtask can be `IN_PROGRESS` and overdue at the
 * same time and the history stays honest about what the person was doing.
 */
import type { Role, SubtaskStatus } from '@prisma/client';

/** Everything a caller can ask the machine to do. */
export type SubtaskAction =
  | 'START'
  | 'COMPLETE'
  | 'PROBLEM'
  | 'APPROVE'
  | 'REJECT'
  | 'RESOLVE_PROBLEM'
  | 'HOLD'
  | 'UNHOLD'
  | 'CANCEL'
  | 'BLOCK'
  | 'UNBLOCK';

/** How the subtask's predecessor stands, from the caller's point of view. */
export type DependencyState = 'NONE' | 'COMPLETE' | 'INCOMPLETE';

/** `SYSTEM` is the sweeper and the publish routine, which have no human actor. */
export type TransitionActor = Role | 'SYSTEM';

export interface TransitionContext {
  actorRole: TransitionActor;
  /** True when the actor holds this subtask. */
  isAssignee: boolean;
  /** FR-25: when set, "completed" becomes `AWAITING_APPROVAL` instead. */
  requiresApproval: boolean;
  dependency: DependencyState;
  /** FR-32, for `PROBLEM`. */
  problemDescriptionLength?: number;
  problemSeverityProvided?: boolean;
  /** Settings-driven; defaults to the seeded `problem.min_description_length`. */
  minProblemDescriptionLength?: number;
  /** Hold and cancel put a reason on the record. */
  reasonProvided?: boolean;
  /** A rejection has to say what was wrong. */
  rejectionNoteProvided?: boolean;
}

export type TransitionFailure = 'INVALID_TRANSITION' | 'GUARD_FAILED';

export type TransitionResult =
  { ok: true; next: SubtaskStatus } | { ok: false; error: TransitionFailure; reason: string };

/** SDD section 3.4 default. */
export const DEFAULT_MIN_PROBLEM_DESCRIPTION = 20;

/** Terminal: nothing leaves these. */
export const TERMINAL_STATUSES: readonly SubtaskStatus[] = ['COMPLETED', 'CANCELLED'];

/**
 * "Any active" in the SDD's hold/cancel row.
 *
 * `ON_HOLD` is excluded — it is already paused — and the terminal pair are
 * excluded because there is nothing left to stop.
 */
export const ACTIVE_STATUSES: readonly SubtaskStatus[] = [
  'PENDING',
  'BLOCKED',
  'IN_PROGRESS',
  'PROBLEM',
  'AWAITING_APPROVAL',
];

function fail(error: TransitionFailure, reason: string): TransitionResult {
  return { ok: false, error, reason };
}

function allow(next: SubtaskStatus): TransitionResult {
  return { ok: true, next };
}

/** MD and Deputy share the command capabilities. */
function isCommand(role: TransitionActor): boolean {
  return role === 'MD' || role === 'DEPUTY_MD';
}

/**
 * Whether the actor may drive the *member-side* actions — start, complete,
 * report a problem.
 *
 * The assignee always may. The MD may act on anyone's subtask (SDD section 6.3,
 * "Update another's subtask status: MD ✔"); a Deputy may not, which is why the
 * role is checked rather than just `isCommand`.
 */
function actsForAssignee(ctx: TransitionContext): boolean {
  return ctx.isAssignee || ctx.actorRole === 'MD';
}

/**
 * Applies the SDD section 4.3 table.
 *
 * Two distinct failures, because they mean different things to a caller:
 * `INVALID_TRANSITION` says the move does not exist from here (HTTP 409);
 * `GUARD_FAILED` says the move exists but a precondition is unmet — a missing
 * reason, an incomplete dependency, too short a problem description.
 */
export function transition(
  current: SubtaskStatus,
  action: SubtaskAction,
  ctx: TransitionContext,
): TransitionResult {
  // Nothing leaves a terminal state, whatever the action or the actor.
  if (TERMINAL_STATUSES.includes(current)) {
    return fail(
      'INVALID_TRANSITION',
      `This subtask is already ${current.toLowerCase()} and cannot be changed.`,
    );
  }

  switch (action) {
    // --- Member-side ------------------------------------------------------
    case 'START': {
      if (current !== 'PENDING') {
        return fail('INVALID_TRANSITION', 'Work can only be started on a pending subtask.');
      }
      if (!actsForAssignee(ctx)) {
        return fail('GUARD_FAILED', 'Only the assignee can start this work.');
      }
      // The SDD guard: "dependency complete or absent".
      if (ctx.dependency === 'INCOMPLETE') {
        return fail('GUARD_FAILED', 'The subtask this one depends on is not finished yet.');
      }
      return allow('IN_PROGRESS');
    }

    case 'COMPLETE': {
      if (current !== 'PENDING' && current !== 'IN_PROGRESS') {
        return fail(
          'INVALID_TRANSITION',
          'Only a pending or in-progress subtask can be marked completed.',
        );
      }
      if (!actsForAssignee(ctx)) {
        return fail('GUARD_FAILED', 'Only the assignee can complete this work.');
      }
      if (ctx.dependency === 'INCOMPLETE') {
        return fail('GUARD_FAILED', 'The subtask this one depends on is not finished yet.');
      }
      // FR-25 / improvement I-04: self-declared completion is the weakest link,
      // so the flagged subtasks wait for the MD instead.
      return allow(ctx.requiresApproval ? 'AWAITING_APPROVAL' : 'COMPLETED');
    }

    case 'PROBLEM': {
      if (current !== 'PENDING' && current !== 'IN_PROGRESS') {
        return fail(
          'INVALID_TRANSITION',
          'A problem can only be reported on a pending or in-progress subtask.',
        );
      }
      if (!actsForAssignee(ctx)) {
        return fail('GUARD_FAILED', 'Only the assignee can report a problem here.');
      }

      const minimum = ctx.minProblemDescriptionLength ?? DEFAULT_MIN_PROBLEM_DESCRIPTION;
      if ((ctx.problemDescriptionLength ?? 0) < minimum) {
        // FR-32. A one-word problem report is not a problem report, and the MD
        // cannot act on it.
        return fail(
          'GUARD_FAILED',
          `Describe the problem in at least ${minimum} characters so the MD can act on it.`,
        );
      }
      if (!ctx.problemSeverityProvided) {
        return fail('GUARD_FAILED', 'Choose how serious the problem is.');
      }

      return allow('PROBLEM');
    }

    // --- Approval (FR-25) --------------------------------------------------
    case 'APPROVE': {
      if (current !== 'AWAITING_APPROVAL') {
        return fail('INVALID_TRANSITION', 'This subtask is not waiting for approval.');
      }
      if (!isCommand(ctx.actorRole)) {
        return fail('GUARD_FAILED', 'Only the MD or the deputy can approve completion.');
      }
      return allow('COMPLETED');
    }

    case 'REJECT': {
      if (current !== 'AWAITING_APPROVAL') {
        return fail('INVALID_TRANSITION', 'This subtask is not waiting for approval.');
      }
      if (!isCommand(ctx.actorRole)) {
        return fail('GUARD_FAILED', 'Only the MD or the deputy can reject completion.');
      }
      if (!ctx.rejectionNoteProvided) {
        return fail('GUARD_FAILED', 'Say what still needs doing before sending it back.');
      }
      return allow('IN_PROGRESS');
    }

    // --- Problem resolution (M6 refines the MD-side flow) ------------------
    case 'RESOLVE_PROBLEM': {
      if (current !== 'PROBLEM') {
        return fail('INVALID_TRANSITION', 'There is no open problem on this subtask.');
      }
      if (!isCommand(ctx.actorRole)) {
        return fail('GUARD_FAILED', 'Only the MD or the deputy can resolve a problem.');
      }
      // FR-43: the subtask returns to IN_PROGRESS on resolution.
      return allow('IN_PROGRESS');
    }

    // --- Command-side pause and stop --------------------------------------
    case 'HOLD': {
      if (!ACTIVE_STATUSES.includes(current)) {
        return fail('INVALID_TRANSITION', 'This subtask cannot be put on hold from here.');
      }
      if (!isCommand(ctx.actorRole)) {
        return fail('GUARD_FAILED', 'Only the MD or the deputy can put work on hold.');
      }
      if (!ctx.reasonProvided) {
        return fail('GUARD_FAILED', 'Give a reason — it goes on the record.');
      }
      return allow('ON_HOLD');
    }

    /**
     * Not in the SDD table, which offers no way out of `ON_HOLD` and would
     * therefore strand a held subtask permanently. Noted in docs/DEFERRED.md.
     *
     * It returns to `PENDING` rather than to whatever preceded the hold: the
     * previous status is not stored, and `PENDING` is the honest, least
     * surprising restart — a dependency check re-blocks it if needed.
     */
    case 'UNHOLD': {
      if (current !== 'ON_HOLD') {
        return fail('INVALID_TRANSITION', 'This subtask is not on hold.');
      }
      if (!isCommand(ctx.actorRole)) {
        return fail('GUARD_FAILED', 'Only the MD or the deputy can resume work.');
      }
      return allow(ctx.dependency === 'INCOMPLETE' ? 'BLOCKED' : 'PENDING');
    }

    case 'CANCEL': {
      // Cancelling a held subtask is allowed — a paused task still has to be
      // stoppable — which is why ON_HOLD is added to the active set here.
      if (!ACTIVE_STATUSES.includes(current) && current !== 'ON_HOLD') {
        return fail('INVALID_TRANSITION', 'This subtask cannot be cancelled from here.');
      }
      if (!isCommand(ctx.actorRole)) {
        return fail('GUARD_FAILED', 'Only the MD or the deputy can cancel a subtask.');
      }
      if (!ctx.reasonProvided) {
        return fail('GUARD_FAILED', 'Give a reason — it goes on the record.');
      }
      return allow('CANCELLED');
    }

    // --- System-driven dependency tracking --------------------------------
    case 'BLOCK': {
      if (current !== 'PENDING') {
        return fail('INVALID_TRANSITION', 'Only a pending subtask can be blocked.');
      }
      if (ctx.actorRole !== 'SYSTEM') {
        return fail('GUARD_FAILED', 'Blocking is driven by dependencies, not by hand.');
      }
      if (ctx.dependency !== 'INCOMPLETE') {
        return fail('GUARD_FAILED', 'There is no unfinished dependency to block on.');
      }
      return allow('BLOCKED');
    }

    case 'UNBLOCK': {
      if (current !== 'BLOCKED') {
        return fail('INVALID_TRANSITION', 'This subtask is not blocked.');
      }
      if (ctx.actorRole !== 'SYSTEM') {
        return fail('GUARD_FAILED', 'Unblocking is driven by dependencies, not by hand.');
      }
      if (ctx.dependency === 'INCOMPLETE') {
        return fail('GUARD_FAILED', 'The dependency is still unfinished.');
      }
      return allow('PENDING');
    }

    default: {
      // Exhaustiveness guard: a new action nobody decided on fails to compile
      // here rather than falling through to a permissive default.
      const exhaustive: never = action;
      throw new Error(`Unhandled subtask action: ${String(exhaustive)}`);
    }
  }
}

/** Convenience for the UI: which actions this actor could attempt right now. */
export function availableActions(current: SubtaskStatus, ctx: TransitionContext): SubtaskAction[] {
  const all: SubtaskAction[] = [
    'START',
    'COMPLETE',
    'PROBLEM',
    'APPROVE',
    'REJECT',
    'RESOLVE_PROBLEM',
    'HOLD',
    'UNHOLD',
    'CANCEL',
  ];

  return all.filter((action) => {
    // Reasons and notes are supplied by the form, so assume them present when
    // asking "could this be offered?".
    const result = transition(current, action, {
      ...ctx,
      reasonProvided: true,
      rejectionNoteProvided: true,
      problemDescriptionLength: ctx.minProblemDescriptionLength ?? DEFAULT_MIN_PROBLEM_DESCRIPTION,
      problemSeverityProvided: true,
    });
    return result.ok;
  });
}
