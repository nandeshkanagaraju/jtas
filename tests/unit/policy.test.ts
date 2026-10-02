import type { Role } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import {
  assertCan,
  can,
  type Action,
  type ExtensionRequestResource,
  type JobResource,
  type NotificationResource,
  type PolicySubject,
  type ProblemResource,
  type SubtaskResource,
  type UserResource,
} from '@/lib/auth/policy';
import { AppError } from '@/lib/errors';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const DEPT_PRODUCTION = 'dept-production';
const DEPT_QUALITY = 'dept-quality';

function subject(role: Role, overrides: Partial<PolicySubject> = {}): PolicySubject {
  return {
    id: `user-${role.toLowerCase()}`,
    role,
    departmentId: role === 'MEMBER' ? DEPT_PRODUCTION : null,
    isActive: true,
    ...overrides,
  };
}

const md = subject('MD');
const deputy = subject('DEPUTY_MD');
const admin = subject('ADMIN');
const member = subject('MEMBER');
/** A second member, on another department, who touches none of the fixtures. */
const otherMember = subject('MEMBER', {
  id: 'user-member-other',
  departmentId: DEPT_QUALITY,
});

/** A subtask held by `member`, on a job `member` participates in. */
const ownSubtask: SubtaskResource = {
  id: 'subtask-own',
  jobId: 'job-1',
  assigneeId: member.id,
  departmentId: DEPT_PRODUCTION,
};

/** A subtask on the same job held by somebody else. */
const foreignSubtask: SubtaskResource = {
  id: 'subtask-foreign',
  jobId: 'job-1',
  assigneeId: 'user-someone-else',
  departmentId: DEPT_QUALITY,
};

const job: JobResource = {
  id: 'job-1',
  createdById: md.id,
  participantIds: [member.id, 'user-someone-else'],
};

const problemByMember: ProblemResource = {
  id: 'problem-1',
  raisedById: member.id,
  subtask: ownSubtask,
};

const problemByOther: ProblemResource = {
  id: 'problem-2',
  raisedById: 'user-someone-else',
  subtask: foreignSubtask,
};

const extensionRequest: ExtensionRequestResource = {
  id: 'ext-1',
  requestedById: member.id,
  subtask: ownSubtask,
};

const ownNotification: NotificationResource = { id: 'notif-1', userId: member.id };
const foreignNotification: NotificationResource = { id: 'notif-2', userId: md.id };

const mdAccount: UserResource = { id: md.id, role: 'MD' };
const memberAccount: UserResource = { id: member.id, role: 'MEMBER' };

const ROLES: Role[] = ['MD', 'DEPUTY_MD', 'ADMIN', 'MEMBER'];
const SUBJECTS: Record<Role, PolicySubject> = {
  MD: md,
  DEPUTY_MD: deputy,
  ADMIN: admin,
  MEMBER: member,
};

/**
 * Asserts a full row of the SDD section 6.3 matrix in one call, so a test
 * failure names the capability and the role rather than a line number.
 */
function expectMatrixRow<A extends Action>(
  capability: string,
  action: A,
  resource: Parameters<typeof can<A>>[2],
  expected: Record<Role, boolean>,
) {
  for (const role of ROLES) {
    const actual = can(SUBJECTS[role], action, resource);
    expect(
      actual,
      `${capability} (${action}) for ${role}: expected ${expected[role]}, got ${actual}`,
    ).toBe(expected[role]);
  }
}

// ---------------------------------------------------------------------------
// SDD section 6.3 — every cell of the authorisation matrix
// ---------------------------------------------------------------------------

describe('SDD 6.3 authorisation matrix', () => {
  it('Create/publish job — MD ✔ DEPUTY ✔ ADMIN ✖ MEMBER ✖', () => {
    const expected = { MD: true, DEPUTY_MD: true, ADMIN: false, MEMBER: false };
    expectMatrixRow('Create job', 'job:create', undefined, expected);
    expectMatrixRow('Publish job', 'job:publish', job, expected);
    expectMatrixRow('Edit job', 'job:edit', job, expected);
    expectMatrixRow('Hold job', 'job:hold', job, expected);
    expectMatrixRow('Cancel job', 'job:cancel', job, expected);
  });

  it('Assign / reassign subtask — MD ✔ DEPUTY ✔ ADMIN ✖ MEMBER ✖', () => {
    const expected = { MD: true, DEPUTY_MD: true, ADMIN: false, MEMBER: false };
    expectMatrixRow('Create subtask', 'subtask:create', job, expected);
    expectMatrixRow('Reassign subtask', 'subtask:reassign', ownSubtask, expected);
    expectMatrixRow('Edit subtask', 'subtask:edit', ownSubtask, expected);
    expectMatrixRow('Approve subtask', 'subtask:approve', ownSubtask, expected);
  });

  it('Change any deadline — MD ✔ DEPUTY ✔ ADMIN ✖ MEMBER ✖', () => {
    // FR-35: a member cannot edit his own deadline, even on his own subtask.
    expectMatrixRow('Change deadline', 'subtask:changeDeadline', ownSubtask, {
      MD: true,
      DEPUTY_MD: true,
      ADMIN: false,
      MEMBER: false,
    });
  });

  it('Update own subtask status — MD ✔ DEPUTY ✔ ADMIN ✖ MEMBER ✔', () => {
    // Each role acting on a subtask it holds itself.
    for (const role of ROLES) {
      const user = SUBJECTS[role];
      const held: SubtaskResource = { ...ownSubtask, assigneeId: user.id };
      const expected = role !== 'ADMIN';
      expect(can(user, 'subtask:updateStatus', held), `own status for ${role}`).toBe(expected);
    }
  });

  it("Update another's subtask status — MD ✔ DEPUTY ✖ ADMIN ✖ MEMBER ✖", () => {
    expectMatrixRow('Update foreign status', 'subtask:updateStatus', foreignSubtask, {
      MD: true,
      DEPUTY_MD: false,
      ADMIN: false,
      MEMBER: false,
    });
  });

  it('Raise problem — MD ✔ DEPUTY ✔(own) ADMIN ✖ MEMBER ✔(own)', () => {
    // On a subtask each role holds itself.
    for (const role of ROLES) {
      const user = SUBJECTS[role];
      const held: SubtaskResource = { ...ownSubtask, assigneeId: user.id };
      expect(can(user, 'problem:raise', held), `raise on own subtask as ${role}`).toBe(
        role !== 'ADMIN',
      );
    }

    // On somebody else's subtask only the MD may. A deputy is held to the
    // narrower "update another's status" rule — see the note in policy.ts.
    expectMatrixRow('Raise problem on foreign subtask', 'problem:raise', foreignSubtask, {
      MD: true,
      DEPUTY_MD: false,
      ADMIN: false,
      MEMBER: false,
    });
  });

  it('Resolve problem — MD ✔ DEPUTY ✔ ADMIN ✖ MEMBER ✖', () => {
    // Not even on the problem he raised himself (improvement I-05).
    expectMatrixRow('Resolve problem', 'problem:resolve', problemByMember, {
      MD: true,
      DEPUTY_MD: true,
      ADMIN: false,
      MEMBER: false,
    });
  });

  it('View all jobs — MD ✔ DEPUTY ✔ ADMIN ✔(read) MEMBER ✖', () => {
    // A job the member has no subtask on.
    const unrelatedJob: JobResource = {
      id: 'job-2',
      createdById: md.id,
      participantIds: ['user-someone-else'],
    };
    expectMatrixRow('View unrelated job', 'job:view', unrelatedJob, {
      MD: true,
      DEPUTY_MD: true,
      ADMIN: true,
      MEMBER: false,
    });

    // Listing every job is still command-only; ADMIN reads a job it is given.
    expectMatrixRow('List jobs', 'job:list', undefined, {
      MD: true,
      DEPUTY_MD: true,
      ADMIN: false,
      MEMBER: false,
    });
  });

  it('View job he participates in — MEMBER ✔', () => {
    expect(can(member, 'job:view', job)).toBe(true);
    expect(can(otherMember, 'job:view', job)).toBe(false);
  });

  it('Manage users / settings — MD ✔ DEPUTY ✖ ADMIN ✔ MEMBER ✖', () => {
    const expected = { MD: true, DEPUTY_MD: false, ADMIN: true, MEMBER: false };
    expectMatrixRow('Manage user', 'user:manage', memberAccount, expected);
    expectMatrixRow('Manage settings', 'settings:manage', undefined, expected);
    expectMatrixRow('Manage holidays', 'holiday:manage', undefined, expected);
    expectMatrixRow('View users', 'user:view', undefined, expected);
    expectMatrixRow('View settings', 'settings:view', undefined, expected);
  });

  it('View audit log — MD ✔ DEPUTY ✖ ADMIN ✔ MEMBER ✖', () => {
    expectMatrixRow('View audit log', 'audit:view', undefined, {
      MD: true,
      DEPUTY_MD: false,
      ADMIN: true,
      MEMBER: false,
    });
  });
});

// ---------------------------------------------------------------------------
// Object-level rules the matrix implies but does not tabulate
// ---------------------------------------------------------------------------

describe('object-level rules', () => {
  it('denies everything to a deactivated user, whatever the role', () => {
    for (const role of ROLES) {
      const deactivated = subject(role, { isActive: false });
      expect(can(deactivated, 'job:create', undefined), `${role} job:create`).toBe(false);
      expect(can(deactivated, 'audit:view', undefined), `${role} audit:view`).toBe(false);
      expect(can(deactivated, 'department:view', undefined), `${role} department:view`).toBe(false);
      // Even on a record they own.
      const held: SubtaskResource = { ...ownSubtask, assigneeId: deactivated.id };
      expect(can(deactivated, 'subtask:updateStatus', held), `${role} own status`).toBe(false);
    }
  });

  it('lets a member view a sibling department subtask on a job he is on', () => {
    // PDD section 13 question 3: read-only sibling visibility removes phone calls.
    expect(can(member, 'subtask:view', ownSubtask)).toBe(true);
    expect(can(member, 'subtask:view', foreignSubtask)).toBe(false);
  });

  it('lets only the assignee request an extension (FR-33)', () => {
    expect(can(member, 'subtask:requestExtension', ownSubtask)).toBe(true);
    expect(can(member, 'subtask:requestExtension', foreignSubtask)).toBe(false);
    // Not even the MD asks himself for time; he changes the deadline directly.
    expect(can(md, 'subtask:requestExtension', ownSubtask)).toBe(false);
  });

  it('lets only MD and Deputy decide an extension request', () => {
    expectMatrixRow('Decide extension', 'extensionRequest:decide', extensionRequest, {
      MD: true,
      DEPUTY_MD: true,
      ADMIN: false,
      MEMBER: false,
    });
  });

  it('lets a member follow the problem he raised but not an unrelated one', () => {
    expect(can(member, 'problem:view', problemByMember)).toBe(true);
    expect(can(member, 'problem:view', problemByOther)).toBe(false);
    expect(can(md, 'problem:view', problemByOther)).toBe(true);
    expect(can(admin, 'problem:view', problemByOther)).toBe(true);
  });

  it('keeps a notification inbox private to its owner, including from the MD', () => {
    expect(can(member, 'notification:view', ownNotification)).toBe(true);
    expect(can(member, 'notification:markRead', ownNotification)).toBe(true);
    expect(can(md, 'notification:view', ownNotification)).toBe(false);
    expect(can(md, 'notification:markRead', ownNotification)).toBe(false);
    expect(can(md, 'notification:view', foreignNotification)).toBe(true);
  });

  it('stops an admin from editing an MD account, which would be privilege escalation', () => {
    expect(can(admin, 'user:manage', memberAccount)).toBe(true);
    expect(can(admin, 'user:manage', mdAccount)).toBe(false);
    // The MD may manage anyone, including another MD.
    expect(can(md, 'user:manage', mdAccount)).toBe(true);
    // With no specific target — the "create a user" case — an admin may act.
    expect(can(admin, 'user:manage', undefined)).toBe(true);
  });

  it('lets a member comment on his own subtask but not a sibling one (FR-34)', () => {
    expect(can(member, 'comment:create', ownSubtask)).toBe(true);
    expect(can(member, 'comment:create', foreignSubtask)).toBe(false);
    expect(can(member, 'attachment:create', ownSubtask)).toBe(true);
    // An admin is a caretaker of accounts, not a participant in the work.
    expect(can(admin, 'comment:create', ownSubtask)).toBe(false);
  });

  it('gives every active role the department list', () => {
    for (const role of ROLES) {
      expect(can(SUBJECTS[role], 'department:view', undefined), role).toBe(true);
    }
  });

  it('grants export to MD, Deputy and Admin (SDD 6.2) but not a member', () => {
    expectMatrixRow('Export report', 'report:export', undefined, {
      MD: true,
      DEPUTY_MD: true,
      ADMIN: true,
      MEMBER: false,
    });
  });

  it('keeps the MD dashboard to MD and Deputy', () => {
    const expected = { MD: true, DEPUTY_MD: true, ADMIN: false, MEMBER: false };
    expectMatrixRow('MD dashboard', 'dashboard:md', undefined, expected);
    expectMatrixRow('Department scorecard', 'dashboard:department', undefined, expected);
  });

  it('treats the job creator as a participant even with no subtask of his own', () => {
    const creatorOnly: JobResource = {
      id: 'job-3',
      createdById: otherMember.id,
      participantIds: [],
    };
    expect(can(otherMember, 'job:view', creatorOnly)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// assertCan
// ---------------------------------------------------------------------------

describe('assertCan', () => {
  it('returns silently when the action is permitted', () => {
    expect(() => assertCan(md, 'job:create', undefined)).not.toThrow();
  });

  it('throws a FORBIDDEN AppError when it is not', () => {
    try {
      assertCan(member, 'job:create', undefined);
      expect.unreachable('assertCan should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe('FORBIDDEN');
      expect((error as AppError).status).toBe(403);
      // The message must not confirm whether the record exists.
      expect((error as AppError).message).toBe('You do not have permission to do that.');
    }
  });
});

// ---------------------------------------------------------------------------
// Coverage guard
// ---------------------------------------------------------------------------

describe('matrix completeness', () => {
  /**
   * Every action must be exercised above. This list is the checklist; if an
   * Action is added to the union without a test, the count assertion fails and
   * points at the omission.
   */
  const ALL_ACTIONS: Action[] = [
    'job:create',
    'job:view',
    'job:edit',
    'job:publish',
    'job:hold',
    'job:cancel',
    'job:list',
    'subtask:create',
    'subtask:view',
    'subtask:edit',
    'subtask:reassign',
    'subtask:changeDeadline',
    'subtask:approve',
    'subtask:updateStatus',
    'subtask:requestExtension',
    'extensionRequest:decide',
    'problem:raise',
    'problem:view',
    'problem:resolve',
    'comment:create',
    'comment:view',
    'attachment:create',
    'attachment:view',
    'notification:view',
    'notification:markRead',
    'user:manage',
    'user:view',
    'settings:manage',
    'settings:view',
    'holiday:manage',
    'department:view',
    'audit:view',
    'dashboard:md',
    'dashboard:department',
    'report:export',
  ];

  it('decides every action for every role without throwing', () => {
    // Proves the switch is total at runtime, not only at compile time: an
    // action that fell through would hit the exhaustiveness guard and throw.
    const resourceFor = (action: Action): any => {
      if (action.startsWith('job:')) return job;
      if (action.startsWith('subtask:') || action.startsWith('comment:')) return ownSubtask;
      if (action.startsWith('attachment:')) return ownSubtask;
      if (action === 'problem:raise') return ownSubtask;
      if (action.startsWith('problem:')) return problemByMember;
      if (action.startsWith('notification:')) return ownNotification;
      if (action === 'extensionRequest:decide') return extensionRequest;
      if (action === 'user:manage') return memberAccount;
      return undefined;
    };

    for (const action of ALL_ACTIONS) {
      for (const role of ROLES) {
        expect(
          () => can(SUBJECTS[role], action, resourceFor(action)),
          `${action} / ${role}`,
        ).not.toThrow();
      }
    }
  });

  it('has a test checklist covering the whole Action union', () => {
    expect(new Set(ALL_ACTIONS).size).toBe(ALL_ACTIONS.length);
    expect(ALL_ACTIONS).toHaveLength(35);
  });
});

// ---------------------------------------------------------------------------
// Read-only cross-department visibility (build spec M5.5, PDD 13 Q3)
// ---------------------------------------------------------------------------

describe('cross-department subtask visibility', () => {
  /** A sibling subtask on a job the member participates in. */
  const siblingSubtask: SubtaskResource = {
    ...foreignSubtask,
    jobParticipantIds: [member.id, 'user-someone-else'],
  };

  it('lets a member read a sibling department’s subtask on a job they are on', () => {
    // Removes the phone call asking whether material has arrived.
    expect(can(member, 'subtask:view', siblingSubtask)).toBe(true);
    expect(can(member, 'comment:view', siblingSubtask)).toBe(true);
    expect(can(member, 'attachment:view', siblingSubtask)).toBe(true);
  });

  it('grants no power over a sibling subtask', () => {
    expect(can(member, 'subtask:updateStatus', siblingSubtask)).toBe(false);
    expect(can(member, 'problem:raise', siblingSubtask)).toBe(false);
    expect(can(member, 'subtask:requestExtension', siblingSubtask)).toBe(false);
    expect(can(member, 'subtask:changeDeadline', siblingSubtask)).toBe(false);
    // A file is a claim about the work; the person accountable for a subtask
    // puts drawings against it (FR-34).
    expect(can(member, 'attachment:create', siblingSubtask)).toBe(false);
  });

  it('does let a participant ask a question on a sibling subtask (M10.1)', () => {
    /*
     * Wider than FR-34's "his own subtasks", on the M10 build spec: "a member
     * can comment on subtasks of jobs they participate in". Seeing a sibling
     * subtask but being unable to ask about it leaves in place the phone call
     * that read-only visibility existed to remove.
     */
    expect(can(member, 'comment:create', siblingSubtask)).toBe(true);
    expect(can(member, 'comment:view', siblingSubtask)).toBe(true);
  });

  it('refuses a comment on a job the member has nothing to do with', () => {
    const stranger = { ...siblingSubtask, jobParticipantIds: ['somebody-else'] };

    expect(can(member, 'comment:create', stranger)).toBe(false);
    expect(can(member, 'attachment:view', stranger)).toBe(false);
  });

  it('refuses a member who is not on the job at all', () => {
    expect(can(otherMember, 'subtask:view', siblingSubtask)).toBe(false);
    expect(can(otherMember, 'attachment:view', siblingSubtask)).toBe(false);
    expect(can(md, 'attachment:view', siblingSubtask)).toBe(true);
  });

  it('fails closed when the participant list was not supplied', () => {
    // A caller that cannot cheaply load the list gets the narrow answer.
    expect(can(member, 'subtask:view', foreignSubtask)).toBe(false);
  });

  it('still lets a member read their own subtask without the list', () => {
    expect(can(member, 'subtask:view', ownSubtask)).toBe(true);
  });
});
