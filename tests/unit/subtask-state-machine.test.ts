import type { SubtaskStatus } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import {
  ACTIVE_STATUSES,
  DEFAULT_MIN_PROBLEM_DESCRIPTION,
  availableActions,
  transition,
  type SubtaskAction,
  type TransitionActor,
  type TransitionContext,
} from '@/lib/domain/subtask-state-machine';

const ALL_STATUSES: SubtaskStatus[] = [
  'PENDING',
  'BLOCKED',
  'IN_PROGRESS',
  'PROBLEM',
  'AWAITING_APPROVAL',
  'COMPLETED',
  'ON_HOLD',
  'CANCELLED',
];

const ALL_ACTIONS: SubtaskAction[] = [
  'START',
  'COMPLETE',
  'PROBLEM',
  'APPROVE',
  'REJECT',
  'RESOLVE_PROBLEM',
  'HOLD',
  'UNHOLD',
  'CANCEL',
  'BLOCK',
  'UNBLOCK',
];

/** A context that satisfies every guard, so a test only varies what it means to. */
function ctx(overrides: Partial<TransitionContext> = {}): TransitionContext {
  return {
    actorRole: 'MEMBER',
    isAssignee: true,
    requiresApproval: false,
    dependency: 'NONE',
    problemDescriptionLength: 40,
    problemSeverityProvided: true,
    reasonProvided: true,
    rejectionNoteProvided: true,
    ...overrides,
  };
}

const asMd = (o: Partial<TransitionContext> = {}) =>
  ctx({ actorRole: 'MD', isAssignee: false, ...o });
const asDeputy = (o: Partial<TransitionContext> = {}) =>
  ctx({ actorRole: 'DEPUTY_MD', isAssignee: false, ...o });
const asSystem = (o: Partial<TransitionContext> = {}) =>
  ctx({ actorRole: 'SYSTEM', isAssignee: false, ...o });

// ---------------------------------------------------------------------------
// Every legal transition in the SDD 4.3 table
// ---------------------------------------------------------------------------

describe('SDD 4.3 — every legal transition', () => {
  it('PENDING -> IN_PROGRESS by the assignee, dependency complete or absent', () => {
    expect(transition('PENDING', 'START', ctx({ dependency: 'NONE' }))).toEqual({
      ok: true,
      next: 'IN_PROGRESS',
    });
    expect(transition('PENDING', 'START', ctx({ dependency: 'COMPLETE' }))).toEqual({
      ok: true,
      next: 'IN_PROGRESS',
    });
  });

  it('PENDING/IN_PROGRESS -> COMPLETED by the assignee when approval is off', () => {
    for (const from of ['PENDING', 'IN_PROGRESS'] as const) {
      expect(transition(from, 'COMPLETE', ctx({ requiresApproval: false })), from).toEqual({
        ok: true,
        next: 'COMPLETED',
      });
    }
  });

  it('PENDING/IN_PROGRESS -> AWAITING_APPROVAL when approval is on (FR-25)', () => {
    for (const from of ['PENDING', 'IN_PROGRESS'] as const) {
      expect(transition(from, 'COMPLETE', ctx({ requiresApproval: true })), from).toEqual({
        ok: true,
        next: 'AWAITING_APPROVAL',
      });
    }
  });

  it('AWAITING_APPROVAL -> COMPLETED by MD and by Deputy', () => {
    expect(transition('AWAITING_APPROVAL', 'APPROVE', asMd())).toEqual({
      ok: true,
      next: 'COMPLETED',
    });
    expect(transition('AWAITING_APPROVAL', 'APPROVE', asDeputy())).toEqual({
      ok: true,
      next: 'COMPLETED',
    });
  });

  it('AWAITING_APPROVAL -> IN_PROGRESS on rejection, with a note', () => {
    expect(transition('AWAITING_APPROVAL', 'REJECT', asMd())).toEqual({
      ok: true,
      next: 'IN_PROGRESS',
    });
  });

  it('PENDING/IN_PROGRESS -> PROBLEM by the assignee with description and severity', () => {
    for (const from of ['PENDING', 'IN_PROGRESS'] as const) {
      expect(transition(from, 'PROBLEM', ctx()), from).toEqual({ ok: true, next: 'PROBLEM' });
    }
  });

  it('PROBLEM -> IN_PROGRESS by MD and Deputy (FR-43)', () => {
    expect(transition('PROBLEM', 'RESOLVE_PROBLEM', asMd())).toEqual({
      ok: true,
      next: 'IN_PROGRESS',
    });
    expect(transition('PROBLEM', 'RESOLVE_PROBLEM', asDeputy())).toEqual({
      ok: true,
      next: 'IN_PROGRESS',
    });
  });

  it('any active status -> ON_HOLD by MD/Deputy with a reason', () => {
    for (const from of ACTIVE_STATUSES) {
      expect(transition(from, 'HOLD', asMd()), from).toEqual({ ok: true, next: 'ON_HOLD' });
    }
  });

  it('any active status, and ON_HOLD, -> CANCELLED by MD/Deputy with a reason', () => {
    for (const from of [...ACTIVE_STATUSES, 'ON_HOLD'] as SubtaskStatus[]) {
      expect(transition(from, 'CANCEL', asMd()), from).toEqual({ ok: true, next: 'CANCELLED' });
    }
  });

  it('PENDING -> BLOCKED by the system when the dependency is incomplete', () => {
    expect(transition('PENDING', 'BLOCK', asSystem({ dependency: 'INCOMPLETE' }))).toEqual({
      ok: true,
      next: 'BLOCKED',
    });
  });

  it('BLOCKED -> PENDING by the system once the dependency completes', () => {
    expect(transition('BLOCKED', 'UNBLOCK', asSystem({ dependency: 'COMPLETE' }))).toEqual({
      ok: true,
      next: 'PENDING',
    });
  });

  it('ON_HOLD -> PENDING on unhold, or BLOCKED if the dependency is still open', () => {
    // Not in the SDD table, which offers no exit from ON_HOLD at all.
    expect(transition('ON_HOLD', 'UNHOLD', asMd({ dependency: 'COMPLETE' }))).toEqual({
      ok: true,
      next: 'PENDING',
    });
    expect(transition('ON_HOLD', 'UNHOLD', asMd({ dependency: 'INCOMPLETE' }))).toEqual({
      ok: true,
      next: 'BLOCKED',
    });
  });
});

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

describe('guards', () => {
  it('refuses to start or complete while a dependency is unfinished (I-02)', () => {
    // A Production subtask that starts before material is in the Store is a
    // fake deadline.
    for (const action of ['START', 'COMPLETE'] as const) {
      const result = transition('PENDING', action, ctx({ dependency: 'INCOMPLETE' }));
      expect(result, action).toMatchObject({ ok: false, error: 'GUARD_FAILED' });
    }
  });

  it('refuses a problem description shorter than the minimum (FR-32)', () => {
    const short = transition(
      'IN_PROGRESS',
      'PROBLEM',
      ctx({ problemDescriptionLength: DEFAULT_MIN_PROBLEM_DESCRIPTION - 1 }),
    );
    expect(short).toMatchObject({ ok: false, error: 'GUARD_FAILED' });
    expect((short as { reason: string }).reason).toContain('20 characters');

    // Exactly the minimum is enough.
    expect(
      transition(
        'IN_PROGRESS',
        'PROBLEM',
        ctx({ problemDescriptionLength: DEFAULT_MIN_PROBLEM_DESCRIPTION }),
      ),
    ).toMatchObject({ ok: true });
  });

  it('honours a configured minimum description length', () => {
    expect(
      transition(
        'IN_PROGRESS',
        'PROBLEM',
        ctx({ problemDescriptionLength: 30, minProblemDescriptionLength: 50 }),
      ),
    ).toMatchObject({ ok: false, error: 'GUARD_FAILED' });
  });

  it('requires a severity on a problem', () => {
    expect(
      transition('IN_PROGRESS', 'PROBLEM', ctx({ problemSeverityProvided: false })),
    ).toMatchObject({ ok: false, error: 'GUARD_FAILED' });
  });

  it('requires a note on rejection', () => {
    expect(
      transition('AWAITING_APPROVAL', 'REJECT', asMd({ rejectionNoteProvided: false })),
    ).toMatchObject({ ok: false, error: 'GUARD_FAILED' });
  });

  it('requires a reason to hold or cancel', () => {
    for (const action of ['HOLD', 'CANCEL'] as const) {
      expect(
        transition('IN_PROGRESS', action, asMd({ reasonProvided: false })),
        action,
      ).toMatchObject({ ok: false, error: 'GUARD_FAILED' });
    }
  });

  it('refuses to block when there is no unfinished dependency', () => {
    expect(transition('PENDING', 'BLOCK', asSystem({ dependency: 'COMPLETE' }))).toMatchObject({
      ok: false,
      error: 'GUARD_FAILED',
    });
  });

  it('refuses to unblock while the dependency is still unfinished', () => {
    expect(transition('BLOCKED', 'UNBLOCK', asSystem({ dependency: 'INCOMPLETE' }))).toMatchObject({
      ok: false,
      error: 'GUARD_FAILED',
    });
  });
});

// ---------------------------------------------------------------------------
// Who may act
// ---------------------------------------------------------------------------

describe('actor rules (SDD 6.3)', () => {
  it('lets the MD act on somebody else’s subtask', () => {
    expect(transition('PENDING', 'START', asMd())).toMatchObject({ ok: true });
    expect(transition('IN_PROGRESS', 'COMPLETE', asMd())).toMatchObject({ ok: true });
  });

  it('does not let a Deputy complete somebody else’s subtask', () => {
    // "Update another's subtask status" is MD-only; the deputy row is ✖.
    expect(transition('IN_PROGRESS', 'COMPLETE', asDeputy({ isAssignee: false }))).toMatchObject({
      ok: false,
      error: 'GUARD_FAILED',
    });

    // …but a deputy may complete a subtask they hold themselves.
    expect(
      transition('IN_PROGRESS', 'COMPLETE', ctx({ actorRole: 'DEPUTY_MD', isAssignee: true })),
    ).toMatchObject({ ok: true, next: 'COMPLETED' });
  });

  it('does not let a member act on somebody else’s subtask', () => {
    for (const action of ['START', 'COMPLETE', 'PROBLEM'] as const) {
      expect(transition('PENDING', action, ctx({ isAssignee: false })), action).toMatchObject({
        ok: false,
        error: 'GUARD_FAILED',
      });
    }
  });

  it('does not let a member approve, reject, resolve, hold or cancel', () => {
    const cases: Array<[SubtaskStatus, SubtaskAction]> = [
      ['AWAITING_APPROVAL', 'APPROVE'],
      ['AWAITING_APPROVAL', 'REJECT'],
      ['PROBLEM', 'RESOLVE_PROBLEM'],
      ['IN_PROGRESS', 'HOLD'],
      ['IN_PROGRESS', 'CANCEL'],
      ['ON_HOLD', 'UNHOLD'],
    ];

    for (const [from, action] of cases) {
      expect(transition(from, action, ctx()), `${from}/${action}`).toMatchObject({
        ok: false,
        error: 'GUARD_FAILED',
      });
    }
  });

  it('does not let an ADMIN drive any transition', () => {
    // An administrator is a caretaker of accounts, not a participant.
    for (const action of ALL_ACTIONS) {
      const result = transition(
        'IN_PROGRESS',
        action,
        ctx({ actorRole: 'ADMIN', isAssignee: false }),
      );
      expect(result.ok, `${action} should be refused for ADMIN`).toBe(false);
    }
  });

  it('does not let a human block or unblock by hand', () => {
    expect(transition('PENDING', 'BLOCK', asMd({ dependency: 'INCOMPLETE' }))).toMatchObject({
      ok: false,
      error: 'GUARD_FAILED',
    });
    expect(transition('BLOCKED', 'UNBLOCK', asMd())).toMatchObject({
      ok: false,
      error: 'GUARD_FAILED',
    });
  });
});

// ---------------------------------------------------------------------------
// Illegal transitions — the whole grid
// ---------------------------------------------------------------------------

describe('illegal transitions', () => {
  it('refuses everything from a terminal status', () => {
    for (const from of ['COMPLETED', 'CANCELLED'] as const) {
      for (const action of ALL_ACTIONS) {
        const result = transition(from, action, asMd({ dependency: 'INCOMPLETE' }));
        expect(result, `${from}/${action}`).toMatchObject({
          ok: false,
          error: 'INVALID_TRANSITION',
        });
      }
    }
  });

  it('refuses to start anything that is not pending', () => {
    for (const from of ALL_STATUSES.filter((s) => s !== 'PENDING')) {
      expect(transition(from, 'START', asMd()), from).toMatchObject({ ok: false });
    }
  });

  it('refuses to complete from BLOCKED, PROBLEM, AWAITING_APPROVAL or ON_HOLD', () => {
    for (const from of ['BLOCKED', 'PROBLEM', 'AWAITING_APPROVAL', 'ON_HOLD'] as const) {
      expect(transition(from, 'COMPLETE', asMd()), from).toMatchObject({
        ok: false,
        error: 'INVALID_TRANSITION',
      });
    }
  });

  it('refuses to report a problem from BLOCKED, PROBLEM, AWAITING_APPROVAL or ON_HOLD', () => {
    for (const from of ['BLOCKED', 'PROBLEM', 'AWAITING_APPROVAL', 'ON_HOLD'] as const) {
      expect(transition(from, 'PROBLEM', asMd()), from).toMatchObject({
        ok: false,
        error: 'INVALID_TRANSITION',
      });
    }
  });

  it('refuses approve/reject unless the subtask is awaiting approval', () => {
    for (const from of ALL_STATUSES.filter((s) => s !== 'AWAITING_APPROVAL')) {
      for (const action of ['APPROVE', 'REJECT'] as const) {
        expect(transition(from, action, asMd()), `${from}/${action}`).toMatchObject({
          ok: false,
        });
      }
    }
  });

  it('refuses to resolve a problem that is not there', () => {
    for (const from of ALL_STATUSES.filter((s) => s !== 'PROBLEM')) {
      expect(transition(from, 'RESOLVE_PROBLEM', asMd()), from).toMatchObject({ ok: false });
    }
  });

  it('refuses to hold a subtask that is already held', () => {
    expect(transition('ON_HOLD', 'HOLD', asMd())).toMatchObject({
      ok: false,
      error: 'INVALID_TRANSITION',
    });
  });

  it('refuses to unhold anything that is not held', () => {
    for (const from of ALL_STATUSES.filter((s) => s !== 'ON_HOLD')) {
      expect(transition(from, 'UNHOLD', asMd()), from).toMatchObject({ ok: false });
    }
  });

  /**
   * The completeness check the build spec asks for: every (status, action) pair
   * is decided, none throws, and the set that succeeds is exactly the SDD table.
   */
  it('decides all 88 status/action pairs without throwing', () => {
    const legal: string[] = [];

    for (const from of ALL_STATUSES) {
      for (const action of ALL_ACTIONS) {
        // Try each actor kind; a pair is legal if any legitimate actor can do it.
        for (const role of ['MEMBER', 'MD', 'DEPUTY_MD', 'SYSTEM'] as TransitionActor[]) {
          const result = transition(
            from,
            action,
            ctx({
              actorRole: role,
              isAssignee: role === 'MEMBER',
              dependency: action === 'BLOCK' ? 'INCOMPLETE' : 'COMPLETE',
            }),
          );
          if (result.ok) {
            legal.push(`${from} --${action}--> ${result.next}`);
            break;
          }
        }
      }
    }

    expect(ALL_STATUSES.length * ALL_ACTIONS.length).toBe(88);
    expect(new Set(legal).size).toBe(legal.length);
    expect(legal.sort()).toMatchInlineSnapshot(`
      [
        "AWAITING_APPROVAL --APPROVE--> COMPLETED",
        "AWAITING_APPROVAL --CANCEL--> CANCELLED",
        "AWAITING_APPROVAL --HOLD--> ON_HOLD",
        "AWAITING_APPROVAL --REJECT--> IN_PROGRESS",
        "BLOCKED --CANCEL--> CANCELLED",
        "BLOCKED --HOLD--> ON_HOLD",
        "BLOCKED --UNBLOCK--> PENDING",
        "IN_PROGRESS --CANCEL--> CANCELLED",
        "IN_PROGRESS --COMPLETE--> COMPLETED",
        "IN_PROGRESS --HOLD--> ON_HOLD",
        "IN_PROGRESS --PROBLEM--> PROBLEM",
        "ON_HOLD --CANCEL--> CANCELLED",
        "ON_HOLD --UNHOLD--> PENDING",
        "PENDING --BLOCK--> BLOCKED",
        "PENDING --CANCEL--> CANCELLED",
        "PENDING --COMPLETE--> COMPLETED",
        "PENDING --HOLD--> ON_HOLD",
        "PENDING --PROBLEM--> PROBLEM",
        "PENDING --START--> IN_PROGRESS",
        "PROBLEM --CANCEL--> CANCELLED",
        "PROBLEM --HOLD--> ON_HOLD",
        "PROBLEM --RESOLVE_PROBLEM--> IN_PROGRESS",
      ]
    `);
  });
});

// ---------------------------------------------------------------------------
// availableActions
// ---------------------------------------------------------------------------

describe('availableActions', () => {
  it('offers a member exactly what they can do on their own pending subtask', () => {
    expect(availableActions('PENDING', ctx()).sort()).toEqual(['COMPLETE', 'PROBLEM', 'START']);
  });

  it('offers nothing on a blocked subtask, because the dependency decides', () => {
    expect(availableActions('BLOCKED', ctx({ dependency: 'INCOMPLETE' }))).toEqual([]);
  });

  it('offers the MD approve and reject on a subtask awaiting approval', () => {
    expect(availableActions('AWAITING_APPROVAL', asMd()).sort()).toEqual([
      'APPROVE',
      'CANCEL',
      'HOLD',
      'REJECT',
    ]);
  });

  it('offers nothing on a completed or cancelled subtask', () => {
    expect(availableActions('COMPLETED', asMd())).toEqual([]);
    expect(availableActions('CANCELLED', asMd())).toEqual([]);
  });
});
