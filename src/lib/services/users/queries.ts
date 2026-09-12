/**
 * Read paths for the user directory.
 *
 * Separated from the mutations because they have no transaction, no audit row
 * and no invariants — only shaping, filtering and the one grouped query that
 * keeps the table off an N+1.
 */
import type { Prisma } from '@prisma/client';

import { prisma, type Db } from '@/lib/db/prisma';
import { notFound } from '@/lib/errors';
import { toSkipTake, type Paginated } from '@/lib/validation/common';
import type { ListUsersQuery } from '@/lib/validation/user';

import {
  TERMINAL_SUBTASK_STATUSES,
  USER_SELECT,
  toSummary,
  type OpenSubtaskRef,
  type UserSummary,
} from './types';

/** Lists users with filters, search and pagination (SDD section 6.1). */
export async function listUsers(query: ListUsersQuery): Promise<Paginated<UserSummary>> {
  const where: Prisma.UserWhereInput = {};

  if (query.role) where.role = query.role;
  if (query.departmentId) where.departmentId = query.departmentId;
  if (query.status !== 'all') where.isActive = query.status === 'active';

  if (query.q) {
    // Case-insensitive across the three fields an administrator would type.
    where.OR = [
      { name: { contains: query.q, mode: 'insensitive' } },
      { email: { contains: query.q, mode: 'insensitive' } },
      { phone: { contains: query.q, mode: 'insensitive' } },
    ];
  }

  const orderBy: Prisma.UserOrderByWithRelationInput =
    query.sort === 'lastLoginAt'
      ? // Nulls last: a user who has never signed in is the least interesting
        // row when sorting by recency, not the most.
        { lastLoginAt: { sort: query.direction, nulls: 'last' } }
      : { [query.sort]: query.direction };

  const { skip, take } = toSkipTake(query);

  const [rows, total] = await Promise.all([
    prisma.user.findMany({ where, select: USER_SELECT, orderBy, skip, take }),
    prisma.user.count({ where }),
  ]);

  // One grouped query rather than one per row, so the table can warn about
  // open work without an N+1.
  const openCounts = await prisma.subtask.groupBy({
    by: ['assigneeId'],
    where: {
      assigneeId: { in: rows.map((row) => row.id) },
      status: { notIn: TERMINAL_SUBTASK_STATUSES },
    },
    _count: { _all: true },
  });

  const openByUser = new Map(openCounts.map((row) => [row.assigneeId, row._count._all]));

  return {
    data: rows.map((row) => ({
      ...toSummary(row),
      openSubtaskCount: openByUser.get(row.id) ?? 0,
    })),
    page: query.page,
    pageSize: query.pageSize,
    total,
  };
}

/** @throws {AppError} `NOT_FOUND` */
export async function getUser(userId: string): Promise<UserSummary> {
  const row = await prisma.user.findUnique({ where: { id: userId }, select: USER_SELECT });
  if (!row) throw notFound('User');
  return toSummary(row);
}

/** The user's subtasks that are not yet in a terminal state. */
export async function findOpenSubtasks(db: Db, userId: string): Promise<OpenSubtaskRef[]> {
  const subtasks = await db.subtask.findMany({
    where: { assigneeId: userId, status: { notIn: TERMINAL_SUBTASK_STATUSES } },
    select: {
      id: true,
      title: true,
      status: true,
      deadline: true,
      jobId: true,
      departmentId: true,
      job: { select: { jobCode: true } },
      department: { select: { name: true } },
    },
    orderBy: { deadline: 'asc' },
  });

  return subtasks.map((subtask) => ({
    id: subtask.id,
    title: subtask.title,
    status: subtask.status,
    deadline: subtask.deadline,
    jobId: subtask.jobId,
    jobCode: subtask.job.jobCode,
    departmentId: subtask.departmentId,
    departmentName: subtask.department.name,
  }));
}
