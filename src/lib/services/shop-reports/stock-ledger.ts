/**
 * The daily stock ledger: raw material and finished goods per part number.
 *
 * Nobody types the balance. Three people each type their own part of it:
 *
 *   - Store records each receipt in the Store register on a job (RM in).
 *   - Production's accepted pieces on its job task (a count or a closed batch)
 *     move from RM to FG by themselves; its rejected pieces come off RM only.
 *     Work done without a job is entered on the Stock page instead.
 *   - A job manager (Dhiyaneswar) enters each dispatch (off FG).
 *
 *   RM in hand  = opening RM + Store receipts − produced − rejected
 *   FG in hand  = opening FG + produced − dispatched
 *
 * So 2,000 RM received, 1,000 produced and 500 dispatched leaves 1,000 RM and
 * 500 FG; another 500 received makes the RM 1,500.
 *
 * Receipts are matched to a part by their job's part number (trimmed, case
 * ignored). A job with no part number is kept on its own line under its code.
 */
import { prisma } from '@/lib/db/prisma';
import { forbidden } from '@/lib/errors';
import { writeAudit } from '@/lib/services/audit-service';
import { fromISTInput, istDateKey } from '@/lib/utils/time';
import type { RecordStockMovementInput, SetStockOpeningInput } from '@/lib/validation/stock';

export interface StockDay {
  date: string;
  rmReceived: number;
  produced: number;
  /** Production's rejected pieces: their raw material is used up. */
  rejected: number;
  dispatched: number;
  /** Balances at the end of the day. */
  rmBalance: number;
  fgBalance: number;
}

export interface StockPart {
  key: string;
  partNumber: string | null;
  partName: string;
  customer: string | null;
  jobCodes: string[];
  /** The opening someone entered, when there is one. */
  openingSet: { asOfDate: string; rmQty: number; fgQty: number } | null;
  /** Balances at the start of the range. */
  opening: { rm: number; fg: number };
  rmReceived: number;
  produced: number;
  rejected: number;
  dispatched: number;
  /** Balances at the end of the range. */
  closing: { rm: number; fg: number };
  /** Only the days in the range that had a movement. */
  days: StockDay[];
}

/**
 * A production or dispatch line in the range, newest first: typed on the Stock
 * page, or (with `jobCode`) recorded by Production on its job task.
 */
export interface StockEntryRow {
  id: string;
  /** Set when the line came from Production's count on a job; it is removed there, not here. */
  jobCode: string | null;
  rejected: number;
  date: string;
  kind: 'PRODUCED' | 'DISPATCHED';
  partNumber: string;
  partName: string | null;
  quantity: number;
  reference: string | null;
  note: string | null;
  recordedBy: { id: string; name: string };
  createdAt: Date;
}

export interface StockLedger {
  from: string;
  to: string;
  parts: StockPart[];
  entries: StockEntryRow[];
  totals: {
    opening: { rm: number; fg: number };
    rmReceived: number;
    produced: number;
    rejected: number;
    dispatched: number;
    closing: { rm: number; fg: number };
  };
}

/**
 * A `@db.Date` column holds a calendar date with no zone, and Prisma writes it
 * from the UTC date of the value. IST midnight is the previous UTC day, so the
 * date goes in and comes out as UTC midnight instead.
 */
const toDbDate = (key: string) => new Date(`${key}T00:00:00.000Z`);
const fromDbDate = (value: Date) => value.toISOString().slice(0, 10);

export function partKeyOf(partNumber: string): string {
  return partNumber.trim().toLowerCase();
}

interface Movement {
  key: string;
  date: string;
  rmReceived: number;
  produced: number;
  rejected: number;
  dispatched: number;
}

interface JobFacts {
  jobCode: string;
  title: string;
  customerName: string | null;
  partNumber: string | null;
  createdAt: Date;
}

function jobKey(job: JobFacts): string {
  const part = job.partNumber?.trim();
  return part ? partKeyOf(part) : `job:${job.jobCode}`;
}

/** Real, undeleted jobs only: demo history must not move real stock. */
const LIVE_JOB = { isDemo: false, deletedAt: null } as const;

/**
 * The ledger for the IST days `from`..`to` (inclusive, "YYYY-MM-DD"), with
 * every part that has stock or a movement.
 */
export async function stockLedger(from: string, to: string): Promise<StockLedger> {
  const end = new Date(fromISTInput(`${to}T00:00`).getTime() + 24 * 60 * 60_000);

  const jobFacts = {
    select: { jobCode: true, title: true, customerName: true, partNumber: true, createdAt: true },
  } as const;

  const [receipts, typed, openings, jobs, jobCounts] = await Promise.all([
    prisma.storeEntry.findMany({
      where: {
        direction: 'INWARD',
        quantity: { not: null },
        createdAt: { lt: end },
        subtask: { job: LIVE_JOB },
      },
      select: {
        quantity: true,
        createdAt: true,
        subtask: {
          select: {
            job: {
              select: {
                jobCode: true,
                title: true,
                customerName: true,
                partNumber: true,
                createdAt: true,
              },
            },
          },
        },
      },
    }),
    prisma.stockMovement.findMany({
      where: { date: { lte: toDbDate(to) } },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      select: {
        id: true,
        partKey: true,
        partNumber: true,
        partName: true,
        kind: true,
        quantity: true,
        date: true,
        reference: true,
        note: true,
        createdAt: true,
        recordedBy: { select: { id: true, name: true } },
      },
    }),
    prisma.stockOpening.findMany(),
    // Names and customers for parts known only from typed lines.
    prisma.job.findMany({
      where: { ...LIVE_JOB, partNumber: { not: null } },
      select: { jobCode: true, title: true, customerName: true, partNumber: true, createdAt: true },
    }),
    // What Production recorded on its job tasks (counts and closed batches).
    prisma.materialCount.findMany({
      where: {
        createdAt: { lt: end },
        subtask: { department: { code: 'PRODUCTION' }, job: LIVE_JOB },
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        acceptedQty: true,
        rejectedQty: true,
        note: true,
        createdAt: true,
        recordedBy: { select: { id: true, name: true } },
        subtask: { select: { job: jobFacts } },
      },
    }),
  ]);

  // Part facts: the newest job on each part names it.
  const facts = new Map<string, { job: JobFacts; codes: Set<string> }>();
  const note = (job: JobFacts) => {
    const key = jobKey(job);
    const known = facts.get(key);
    if (!known) facts.set(key, { job, codes: new Set([job.jobCode]) });
    else {
      known.codes.add(job.jobCode);
      if (job.createdAt > known.job.createdAt) known.job = job;
    }
    return key;
  };
  for (const job of jobs) note(job);

  const movements: Movement[] = [
    ...receipts.map((row) => ({
      key: note(row.subtask.job),
      date: istDateKey(row.createdAt),
      rmReceived: row.quantity ?? 0,
      produced: 0,
      rejected: 0,
      dispatched: 0,
    })),
    ...jobCounts.map((row) => ({
      key: note(row.subtask.job),
      date: istDateKey(row.createdAt),
      rmReceived: 0,
      produced: row.acceptedQty,
      rejected: row.rejectedQty,
      dispatched: 0,
    })),
    ...typed.map((row) => ({
      key: row.partKey,
      date: fromDbDate(row.date),
      rmReceived: 0,
      produced: row.kind === 'PRODUCED' ? row.quantity : 0,
      rejected: 0,
      dispatched: row.kind === 'DISPATCHED' ? row.quantity : 0,
    })),
  ];

  const openingByKey = new Map(openings.map((row) => [row.partKey, row]));
  const typedName = new Map<string, { partNumber: string; partName: string | null }>();
  for (const row of typed) if (!typedName.has(row.partKey)) typedName.set(row.partKey, row);
  const keys = new Set([...movements.map((m) => m.key), ...openingByKey.keys()]);

  const parts: StockPart[] = [];
  for (const key of keys) {
    const opening = openingByKey.get(key) ?? null;
    const openingDate = opening ? fromDbDate(opening.asOfDate) : null;
    // Before the opening date, movements are already inside the opening figure.
    const counted = movements
      .filter((m) => m.key === key && (!openingDate || m.date >= openingDate) && m.date <= to)
      .sort((a, b) => a.date.localeCompare(b.date));

    let rm = opening?.rmQty ?? 0;
    let fg = opening?.fgQty ?? 0;
    const apply = (m: Movement) => {
      rm += m.rmReceived - m.produced - m.rejected;
      fg += m.produced - m.dispatched;
    };
    for (const m of counted) if (m.date < from) apply(m);
    const start = { rm, fg };

    const byDay = new Map<string, StockDay>();
    for (const m of counted) {
      if (m.date < from) continue;
      apply(m);
      const day = byDay.get(m.date) ?? {
        date: m.date,
        rmReceived: 0,
        produced: 0,
        rejected: 0,
        dispatched: 0,
        rmBalance: 0,
        fgBalance: 0,
      };
      day.rmReceived += m.rmReceived;
      day.produced += m.produced;
      day.rejected += m.rejected;
      day.dispatched += m.dispatched;
      day.rmBalance = rm;
      day.fgBalance = fg;
      byDay.set(m.date, day);
    }
    const days = [...byDay.values()];
    const sum = (field: 'rmReceived' | 'produced' | 'rejected' | 'dispatched') =>
      days.reduce((total, day) => total + day[field], 0);

    // A part with nothing in hand and nothing moving in the range is noise.
    if (days.length === 0 && start.rm === 0 && start.fg === 0) continue;

    const known = facts.get(key);
    const typedPart = typedName.get(key);
    parts.push({
      key,
      partNumber:
        opening?.partNumber ?? known?.job.partNumber?.trim() ?? typedPart?.partNumber ?? null,
      partName:
        opening?.partName ||
        known?.job.title ||
        typedPart?.partName ||
        opening?.partNumber ||
        typedPart?.partNumber ||
        key,
      customer: known?.job.customerName ?? null,
      jobCodes: known ? [...known.codes].sort() : [],
      openingSet: opening
        ? { asOfDate: openingDate!, rmQty: opening.rmQty, fgQty: opening.fgQty }
        : null,
      opening: start,
      rmReceived: sum('rmReceived'),
      produced: sum('produced'),
      rejected: sum('rejected'),
      dispatched: sum('dispatched'),
      closing: { rm, fg },
      days,
    });
  }

  parts.sort(
    (a, b) =>
      (a.partNumber ? 0 : 1) - (b.partNumber ? 0 : 1) || a.partName.localeCompare(b.partName),
  );

  const add = (pick: (part: StockPart) => number) => parts.reduce((t, p) => t + pick(p), 0);
  return {
    from,
    to,
    parts,
    entries: [
      ...typed
        .filter((row) => fromDbDate(row.date) >= from)
        .map((row) => ({
          id: row.id,
          jobCode: null,
          rejected: 0,
          date: fromDbDate(row.date),
          kind: row.kind,
          partNumber: row.partNumber,
          partName: row.partName,
          quantity: row.quantity,
          reference: row.reference,
          note: row.note,
          recordedBy: row.recordedBy,
          createdAt: row.createdAt,
        })),
      ...jobCounts
        .filter((row) => istDateKey(row.createdAt) >= from)
        .map((row) => ({
          id: `count:${row.id}`,
          jobCode: row.subtask.job.jobCode,
          rejected: row.rejectedQty,
          date: istDateKey(row.createdAt),
          kind: 'PRODUCED' as const,
          partNumber: row.subtask.job.partNumber?.trim() || row.subtask.job.jobCode,
          partName: row.subtask.job.title,
          quantity: row.acceptedQty,
          reference: null,
          note: row.note,
          recordedBy: row.recordedBy,
          createdAt: row.createdAt,
        })),
    ].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.getTime() - a.createdAt.getTime()),
    totals: {
      opening: { rm: add((p) => p.opening.rm), fg: add((p) => p.opening.fg) },
      rmReceived: add((p) => p.rmReceived),
      produced: add((p) => p.produced),
      rejected: add((p) => p.rejected),
      dispatched: add((p) => p.dispatched),
      closing: { rm: add((p) => p.closing.rm), fg: add((p) => p.closing.fg) },
    },
  };
}

/** Enters or corrects a part's opening stock. The caller has checked `stock:setOpening`. */
export async function setStockOpening(
  input: SetStockOpeningInput,
  actor: { id: string },
  ctx: { ipAddress?: string | null },
) {
  const partKey = partKeyOf(input.partNumber);
  const data = {
    partNumber: input.partNumber.trim(),
    partName: input.partName?.trim() || null,
    asOfDate: toDbDate(input.asOfDate),
    rmQty: input.rmQty,
    fgQty: input.fgQty,
    setById: actor.id,
  };

  return prisma.$transaction(async (tx) => {
    const before = await tx.stockOpening.findUnique({ where: { partKey } });
    const saved = await tx.stockOpening.upsert({
      where: { partKey },
      create: { partKey, ...data },
      update: data,
    });
    await writeAudit(tx, {
      actorId: actor.id,
      action: 'STOCK_OPENING_SET',
      entityType: 'STOCK_OPENING',
      entityId: saved.id,
      ...(before
        ? {
            before: {
              asOfDate: fromDbDate(before.asOfDate),
              rmQty: before.rmQty,
              fgQty: before.fgQty,
            },
          }
        : {}),
      after: {
        partNumber: saved.partNumber,
        asOfDate: input.asOfDate,
        rmQty: saved.rmQty,
        fgQty: saved.fgQty,
      },
      ipAddress: ctx.ipAddress ?? null,
    });
    return saved;
  });
}

/**
 * Records pieces produced or dispatched for one part on one day. The caller has
 * checked `stock:recordProduced` or `stock:recordDispatch` for `input.kind`.
 */
export async function recordStockMovement(
  input: RecordStockMovementInput,
  actor: { id: string },
  ctx: { ipAddress?: string | null },
) {
  return prisma.$transaction(async (tx) => {
    const saved = await tx.stockMovement.create({
      data: {
        partKey: partKeyOf(input.partNumber),
        partNumber: input.partNumber.trim(),
        partName: input.partName?.trim() || null,
        kind: input.kind,
        quantity: input.quantity,
        date: toDbDate(input.date),
        reference: input.reference?.trim() || null,
        note: input.note?.trim() || null,
        recordedById: actor.id,
      },
    });
    await writeAudit(tx, {
      actorId: actor.id,
      action: input.kind === 'PRODUCED' ? 'STOCK_PRODUCED_RECORDED' : 'STOCK_DISPATCH_RECORDED',
      entityType: 'STOCK_MOVEMENT',
      entityId: saved.id,
      after: {
        partNumber: saved.partNumber,
        date: input.date,
        quantity: saved.quantity,
        reference: saved.reference,
      },
      ipAddress: ctx.ipAddress ?? null,
    });
    return saved;
  });
}

/**
 * Removes a line typed by mistake. Whoever typed it may remove it, and so may
 * the MD and Deputy. Audited, so the record of what was said stays.
 */
export async function deleteStockMovement(
  id: string,
  actor: { id: string; role: string },
  ctx: { ipAddress?: string | null },
) {
  await prisma.$transaction(async (tx) => {
    const row = await tx.stockMovement.findUniqueOrThrow({ where: { id } });
    const command = actor.role === 'MD' || actor.role === 'DEPUTY_MD';
    if (row.recordedById !== actor.id && !command) {
      throw forbidden('Only the person who entered this line, or the MD, can remove it.');
    }
    await tx.stockMovement.delete({ where: { id } });
    await writeAudit(tx, {
      actorId: actor.id,
      action: 'STOCK_MOVEMENT_REMOVED',
      entityType: 'STOCK_MOVEMENT',
      entityId: id,
      before: {
        kind: row.kind,
        partNumber: row.partNumber,
        date: fromDbDate(row.date),
        quantity: row.quantity,
        reference: row.reference,
      },
      ipAddress: ctx.ipAddress ?? null,
    });
  });
}

/** Every part number the shop knows (jobs and openings), for the entry forms. */
export async function knownParts(): Promise<Array<{ partNumber: string; partName: string }>> {
  const [jobs, openings] = await Promise.all([
    prisma.job.findMany({
      where: { ...LIVE_JOB, partNumber: { not: null } },
      orderBy: { createdAt: 'desc' },
      select: { partNumber: true, title: true },
    }),
    prisma.stockOpening.findMany({ select: { partNumber: true, partName: true } }),
  ]);
  const byKey = new Map<string, { partNumber: string; partName: string }>();
  for (const row of openings) {
    byKey.set(partKeyOf(row.partNumber), {
      partNumber: row.partNumber,
      partName: row.partName ?? row.partNumber,
    });
  }
  for (const job of jobs) {
    const partNumber = job.partNumber!.trim();
    if (partNumber && !byKey.has(partKeyOf(partNumber))) {
      byKey.set(partKeyOf(partNumber), { partNumber, partName: job.title });
    }
  }
  return [...byKey.values()].sort((a, b) => a.partName.localeCompare(b.partName));
}
