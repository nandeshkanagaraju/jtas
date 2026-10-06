/**
 * Reading the audit log (build spec M9.4).
 *
 * Read-only by construction: there is no update and no delete in this file, and
 * none anywhere else. `writeAudit` appends; this queries. SDD improvement I-12
 * is "Full audit log, no hard deletes — accountability is the product; it must
 * be provable", and a log with an edit path proves nothing.
 */
import { Prisma } from '@prisma/client';

import { prisma } from '@/lib/db/prisma';
import type { AuditAction, AuditEntityType } from '@/lib/services/audit-service';
import { formatIST } from '@/lib/utils/time';

/** Rows per page. Enough to scan, few enough to render. */
export const AUDIT_PAGE_SIZE = 50;

/** Hard ceiling on an export, so one click cannot pull a year into memory. */
export const AUDIT_EXPORT_LIMIT = 10_000;

export interface AuditFilters {
  actorId?: string;
  entityType?: string;
  entityId?: string;
  action?: string;
  /** IST calendar days, inclusive. */
  from?: string;
  to?: string;
}

export interface AuditEntry {
  id: string;
  createdAt: string;
  action: string;
  entityType: string;
  entityId: string;
  actor: { id: string; name: string; email: string } | null;
  /** Set when a deputy acted for the MD, so the record says on whose behalf. */
  onBehalfOf: string | null;
  ipAddress: string | null;
  /** WEB or TELEGRAM. A chat id is weaker than a signed-in session. */
  source: string;
  before: unknown;
  after: unknown;
  /** Field-level changes, computed for the viewer. */
  diff: AuditDiffEntry[];
}

export interface AuditDiffEntry {
  field: string;
  before: string;
  after: string;
  kind: 'added' | 'removed' | 'changed';
}

export interface AuditPage {
  data: AuditEntry[];
  /** Cursor for the next page, or null at the end. */
  nextCursor: string | null;
  /** Total matching rows, so the viewer can say "1–50 of 812". */
  total: number;
}

function dayStart(key: string): Date {
  return new Date(`${key}T00:00:00+05:30`);
}

function buildWhere(filters: AuditFilters): Prisma.AuditLogWhereInput {
  const where: Prisma.AuditLogWhereInput = {};

  if (filters.actorId) where.actorId = filters.actorId;
  if (filters.entityType) where.entityType = filters.entityType;
  if (filters.entityId) where.entityId = filters.entityId;
  if (filters.action) where.action = filters.action;

  if (filters.from || filters.to) {
    where.createdAt = {
      ...(filters.from ? { gte: dayStart(filters.from) } : {}),
      // Exclusive at the next midnight, so the last day is whole.
      ...(filters.to ? { lt: new Date(dayStart(filters.to).getTime() + 24 * 3_600_000) } : {}),
    };
  }

  return where;
}

const SELECT = {
  id: true,
  createdAt: true,
  action: true,
  entityType: true,
  entityId: true,
  ipAddress: true,
  onBehalfOf: true,
  source: true,
  before: true,
  after: true,
  actor: { select: { id: true, name: true, email: true } },
} satisfies Prisma.AuditLogSelect;

/**
 * One page of the log, newest first.
 *
 * Keyset paging on `(createdAt, id)` rather than `skip`: the log only grows, so
 * an offset walks further into the table on every page, and a row written while
 * somebody is reading shifts everything down by one.
 */
export async function listAudit(
  filters: AuditFilters = {},
  options: { cursor?: string; limit?: number } = {},
): Promise<AuditPage> {
  const where = buildWhere(filters);
  const limit = Math.min(options.limit ?? AUDIT_PAGE_SIZE, 200);

  const [rows, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      select: SELECT,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
    }),
    prisma.auditLog.count({ where }),
  ]);

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  return {
    data: page.map(toEntry),
    nextCursor: hasMore ? page[page.length - 1].id : null,
    total,
  };
}

/** Every row for one entity, oldest first — the trace of a single job. */
export async function auditTrail(
  entityType: AuditEntityType | string,
  entityId: string,
): Promise<AuditEntry[]> {
  const rows = await prisma.auditLog.findMany({
    where: { entityType, entityId },
    select: SELECT,
    orderBy: { createdAt: 'asc' },
  });

  return rows.map(toEntry);
}

/**
 * The trace of one job and everything under it.
 *
 * A job's story is not only its own rows: the subtasks and the problems are
 * where the work actually happened, and a viewer that showed three JOB rows
 * would be answering a different question from the one being asked.
 */
export async function jobAuditTrail(jobId: string): Promise<AuditEntry[]> {
  const [subtasks, problems] = await Promise.all([
    prisma.subtask.findMany({ where: { jobId }, select: { id: true } }),
    prisma.problem.findMany({ where: { subtask: { jobId } }, select: { id: true } }),
  ]);

  const rows = await prisma.auditLog.findMany({
    where: {
      OR: [
        { entityType: 'JOB', entityId: jobId },
        { entityType: 'SUBTASK', entityId: { in: subtasks.map((row) => row.id) } },
        { entityType: 'PROBLEM', entityId: { in: problems.map((row) => row.id) } },
      ],
    },
    select: SELECT,
    orderBy: { createdAt: 'asc' },
  });

  return rows.map(toEntry);
}

/** Distinct actions and entity types present, for the filter dropdowns. */
export async function auditFacets(): Promise<{
  actions: string[];
  entityTypes: string[];
  actors: Array<{ id: string; name: string; email: string }>;
}> {
  const [actions, entityTypes, actors] = await Promise.all([
    prisma.auditLog.findMany({ distinct: ['action'], select: { action: true }, take: 200 }),
    prisma.auditLog.findMany({
      distinct: ['entityType'],
      select: { entityType: true },
      take: 50,
    }),
    prisma.user.findMany({
      where: { auditLogs: { some: {} } },
      select: { id: true, name: true, email: true },
      orderBy: { name: 'asc' },
    }),
  ]);

  return {
    actions: actions.map((row) => row.action).sort(),
    entityTypes: entityTypes.map((row) => row.entityType).sort(),
    actors,
  };
}

type Row = Prisma.AuditLogGetPayload<{ select: typeof SELECT }>;

function toEntry(row: Row): AuditEntry {
  return {
    id: row.id,
    createdAt: row.createdAt.toISOString(),
    action: row.action,
    entityType: row.entityType,
    entityId: row.entityId,
    actor: row.actor,
    onBehalfOf: row.onBehalfOf,
    ipAddress: row.ipAddress,
    source: row.source,
    before: row.before,
    after: row.after,
    diff: diffOf(row.before, row.after),
  };
}

/** Renders a JSON value as one readable line. */
function show(value: unknown): string {
  if (value === undefined) return '—';
  if (value === null) return 'none';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.length === 0 ? 'empty' : value.map(show).join(', ');
  return JSON.stringify(value);
}

/**
 * Field-level changes between the two snapshots.
 *
 * The raw JSON is kept on the row and returned too, but nobody reads a status
 * change out of two pretty-printed objects. This is the line the viewer shows:
 * `status  PENDING → IN_PROGRESS`.
 */
export function diffOf(before: unknown, after: unknown): AuditDiffEntry[] {
  const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

  if (!isRecord(before) && !isRecord(after)) return [];

  const left = isRecord(before) ? before : {};
  const right = isRecord(after) ? after : {};
  const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();

  const diff: AuditDiffEntry[] = [];

  for (const field of keys) {
    const from = left[field];
    const to = right[field];

    if (JSON.stringify(from) === JSON.stringify(to)) continue;

    diff.push({
      field,
      before: show(from),
      after: show(to),
      kind: from === undefined ? 'added' : to === undefined ? 'removed' : 'changed',
    });
  }

  return diff;
}

/** The log as CSV, for the export button. */
export async function auditCsv(filters: AuditFilters = {}): Promise<string> {
  const rows = await prisma.auditLog.findMany({
    where: buildWhere(filters),
    select: SELECT,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: AUDIT_EXPORT_LIMIT,
  });

  const header = [
    'Timestamp (IST)',
    'Actor',
    'Email',
    'Action',
    'Entity type',
    'Entity id',
    'On behalf of',
    'IP address',
    'Source',
    'Changes',
  ];

  const lines = rows.map((row) => {
    const entry = toEntry(row);
    const changes = entry.diff
      .map((change) => `${change.field}: ${change.before} -> ${change.after}`)
      .join('; ');

    return [
      formatIST(row.createdAt),
      row.actor?.name ?? 'system',
      row.actor?.email ?? '',
      row.action,
      row.entityType,
      row.entityId,
      row.onBehalfOf ?? '',
      row.ipAddress ?? '',
      row.source,
      changes,
    ]
      .map(csvCell)
      .join(',');
  });

  return [header.map(csvCell).join(','), ...lines].join('\n');
}

/**
 * Escapes one CSV cell.
 *
 * The leading apostrophe on `=`, `+`, `-` and `@` stops Excel treating a cell
 * as a formula. An audit export is attacker-influenced data — a user's name
 * reaches it — and CSV injection turns a compliance record into code that runs
 * on the auditor's machine.
 */
function csvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export type { AuditAction, AuditEntityType };
