/**
 * The daily production report: opening a shift, recording hours, the final
 * report worked out from them, submission, approval and the two mails.
 *
 * Every caller passes the signed-in user; the rules are in `./access`. The
 * arithmetic is in `lib/domain/production`.
 */
import {
  Prisma,
  type ProductionReportStatus,
  type ProductionSection,
  type ProductionShift,
} from '@prisma/client';

import { prisma, type Db } from '@/lib/db/prisma';
import {
  availableHoursByLine,
  computeLine,
  IDLE_REASON_LABELS,
  IDLE_REASONS,
  idleTotal,
  isLateEntry,
  missingSlots,
  operationLabel,
  readIdle,
  SHIFT_HOURS,
  SHIFT_START_MINUTES,
  shiftSlots,
  slotHasStarted,
  slotLabel,
  type IdleMinutes,
  type LineResult,
  type ProductionWarning,
} from '@/lib/domain/production';
import { conflict, forbidden, invalidTransition, notFound, validationError } from '@/lib/errors';
import { writeAudit } from '@/lib/services/audit-service';
import type {
  AddLineInput,
  AddPartInput,
  OpenReportInput,
  RecordHourInput,
  UpdateLineInput,
} from '@/lib/validation/production';
import { istDateKey, istMinutesOfDay } from '@/lib/utils/time';

import {
  canApproveReport,
  canEditReport,
  canSubmitReport,
  canViewReport,
  isProductionApprover,
  isProductionViewer,
  supervisorSections,
  type ProductionSubject,
} from './access';
import { sendApprovedMail, sendSubmittedMail } from './mail';

const IST_OFFSET_MINUTES = 330;

// ---------------------------------------------------------------------------
// Shift clock
// ---------------------------------------------------------------------------

/** The UTC instant a shift starts, from its IST date. */
export function shiftStartFor(date: string, shift: ProductionShift): Date {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(
    Date.UTC(y, m - 1, d) + (SHIFT_START_MINUTES[shift] - IST_OFFSET_MINUTES) * 60_000,
  );
}

/** The shift running now: before 08:30 it is still last night's. */
export function currentShift(now: Date = new Date()): { date: string; shift: ProductionShift } {
  const minutes = istMinutesOfDay(now);
  if (minutes >= SHIFT_START_MINUTES.NIGHT) return { date: istDateKey(now), shift: 'NIGHT' };
  if (minutes >= SHIFT_START_MINUTES.DAY) return { date: istDateKey(now), shift: 'DAY' };
  return { date: istDateKey(new Date(now.getTime() - 24 * 3_600_000)), shift: 'NIGHT' };
}

function dateOnly(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

const REPORT_INCLUDE = {
  supervisor: { select: { id: true, name: true } },
  approvedBy: { select: { id: true, name: true } },
  lines: {
    orderBy: [{ machine: { sortOrder: 'asc' } }, { position: 'asc' }],
    include: {
      machine: { select: { id: true, code: true, sortOrder: true } },
      part: { select: { id: true, addedById: true } },
      hours: {
        orderBy: { slot: 'asc' },
        include: { recordedBy: { select: { name: true } } },
      },
    },
  },
  changes: {
    orderBy: { createdAt: 'asc' },
    include: { changedBy: { select: { name: true } } },
  },
} satisfies Prisma.ProductionReportInclude;

type ReportRecord = Prisma.ProductionReportGetPayload<{ include: typeof REPORT_INCLUDE }>;
type LineRecord = ReportRecord['lines'][number];

async function loadReport(db: Db, id: string): Promise<ReportRecord> {
  const report = await db.productionReport.findUnique({ where: { id }, include: REPORT_INCLUDE });
  if (!report) throw notFound('Production report');
  return report;
}

// ---------------------------------------------------------------------------
// What crosses the wire
// ---------------------------------------------------------------------------

export interface HourDto {
  slot: number;
  qty: number;
  idle: IdleMinutes;
  note: string | null;
  recordedAt: string;
  recordedBy: string;
  late: boolean;
}

export interface LineDto {
  id: string;
  /** At least one hour is recorded on this line. */
  recorded: boolean;
  machineId: string;
  machineCode: string;
  position: number;
  operatorName: string | null;
  partId: string | null;
  partLabel: string | null;
  operation: number | null;
  operationLabel: string;
  cycleSec: number | null;
  loadSec: number | null;
  standardCycleSec: number | null;
  entered: {
    pcsPerHour: number | null;
    planQty: number | null;
    actualPlanQty: number | null;
    achievedQty: number | null;
    runHours: number | null;
    idle: IdleMinutes | null;
  };
  reworkQty: number;
  rejectionQty: number;
  ncReason: string | null;
  remarks: string | null;
  warningNote: string | null;
  hours: HourDto[];
  result: LineResult;
}

export interface MachineDto {
  id: string;
  code: string;
  lines: LineDto[];
  /**
   * False for a machine with no hour recorded on any line: it is reported as
   * not running and left out of the totals, the warnings and the hour check.
   */
  recorded: boolean;
  missingSlots: number[];
}

export interface ReportTotals {
  planQty: number;
  actualPlanQty: number;
  achievedQty: number;
  reworkQty: number;
  rejectionQty: number;
  idle: IdleMinutes;
  efficiencyPct: number | null;
  utilisationPct: number | null;
  machinesRunning: number;
}

export interface ReportDto {
  id: string;
  date: string;
  shift: ProductionShift;
  section: ProductionSection;
  status: ProductionReportStatus;
  shiftStart: string;
  shiftHours: number;
  slots: Array<{ slot: number; minutes: number; label: string; started: boolean }>;
  remarks: string | null;
  supervisor: { id: string; name: string };
  submittedAt: string | null;
  approvedAt: string | null;
  approvedBy: { id: string; name: string } | null;
  machines: MachineDto[];
  /** Every machine of the section, for adding a line. */
  allMachines: Array<{ id: string; code: string }>;
  totals: ReportTotals;
  warningCount: number;
  lateHours: number;
  changes: Array<{
    id: string;
    label: string;
    before: string | null;
    after: string | null;
    by: string;
    at: string;
  }>;
  can: { edit: boolean; submit: boolean; approve: boolean };
  /** Who is looking: drives the wording on the page. */
  viewerIsApprover: boolean;
}

function lineDto(
  line: LineRecord,
  availableHours: number,
  shiftStart: Date,
  shiftHours: number,
): LineDto {
  const slots = new Map(shiftSlots(shiftHours).map((s) => [s.slot, s]));
  const hours: HourDto[] = line.hours.map((hour) => {
    const slot = slots.get(hour.slot);
    return {
      slot: hour.slot,
      qty: hour.qty,
      idle: readIdle(hour.idle),
      note: hour.note,
      recordedAt: hour.recordedAt.toISOString(),
      recordedBy: hour.recordedBy.name,
      late: slot ? isLateEntry(shiftStart, slot, hour.recordedAt) : false,
    };
  });
  const idleEntered = line.idleEntered === null ? null : readIdle(line.idleEntered);

  const result = computeLine(
    {
      cycleSec: line.cycleSec,
      loadSec: line.loadSec,
      standardCycleSec: line.standardCycleSec,
      partLinked: line.partId !== null,
      partAddedFromFloor: line.part?.addedById != null,
      partLabel: line.partLabel,
      pcsPerHourEntered: line.pcsPerHourEntered,
      planQtyEntered: line.planQtyEntered,
      actualPlanQtyEntered: line.actualPlanQtyEntered,
      achievedQtyEntered: line.achievedQtyEntered,
      runHoursEntered: line.runHoursEntered,
      idleEntered,
      reworkQty: line.reworkQty,
      rejectionQty: line.rejectionQty,
      ncReason: line.ncReason,
    },
    hours,
    availableHours,
  );

  // A line with no hours is a machine that did not run: nothing to check yet.
  if (hours.length === 0) result.warnings = [];

  const late = hours.filter((hour) => hour.late).length;
  if (late > 0) {
    result.warnings.push({
      code: 'LATE_HOURS',
      level: 'info',
      message: `${late} hour${late === 1 ? ' was' : 's were'} recorded more than an hour after ${late === 1 ? 'it' : 'they'} ended.`,
    });
  }

  return {
    id: line.id,
    recorded: hours.length > 0,
    machineId: line.machineId,
    machineCode: line.machine.code,
    position: line.position,
    operatorName: line.operatorName,
    partId: line.partId,
    partLabel: line.partLabel,
    operation: line.operation,
    operationLabel: operationLabel(line.operation),
    cycleSec: line.cycleSec,
    loadSec: line.loadSec,
    standardCycleSec: line.standardCycleSec,
    entered: {
      pcsPerHour: line.pcsPerHourEntered,
      planQty: line.planQtyEntered,
      actualPlanQty: line.actualPlanQtyEntered,
      achievedQty: line.achievedQtyEntered,
      runHours: line.runHoursEntered,
      idle: idleEntered,
    },
    reworkQty: line.reworkQty,
    rejectionQty: line.rejectionQty,
    ncReason: line.ncReason,
    remarks: line.remarks,
    warningNote: line.warningNote,
    hours,
    result,
  };
}

function pctOf(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return Math.round((numerator / denominator) * 1000) / 10;
}

async function toDto(report: ReportRecord, user: ProductionSubject, now: Date): Promise<ReportDto> {
  const allMachines = await prisma.productionMachine.findMany({
    where: { section: report.section, isActive: true },
    orderBy: { sortOrder: 'asc' },
    select: { id: true, code: true },
  });

  const byMachine = new Map<string, LineRecord[]>();
  for (const line of report.lines) {
    const list = byMachine.get(line.machineId) ?? [];
    list.push(line);
    byMachine.set(line.machineId, list);
  }

  const machines: MachineDto[] = [];
  for (const [machineId, lines] of byMachine) {
    const available = availableHoursByLine(lines, report.shiftHours);
    machines.push({
      id: machineId,
      code: lines[0].machine.code,
      lines: lines.map((line) =>
        lineDto(line, available.get(line.id) ?? 0, report.shiftStart, report.shiftHours),
      ),
      recorded: lines.some((line) => line.hours.length > 0),
      missingSlots: missingSlots(lines, report.shiftHours),
    });
  }

  // Only what was recorded counts: a machine left unfilled did not run.
  const flat = machines.flatMap((machine) => machine.lines).filter((line) => line.recorded);
  let idle: IdleMinutes = {};
  for (const line of flat) {
    for (const reason of IDLE_REASONS) {
      const minutes = line.result.idle.value[reason] ?? 0;
      if (minutes > 0) idle = { ...idle, [reason]: (idle[reason] ?? 0) + minutes };
    }
  }
  const planQty = flat.reduce((sum, line) => sum + (line.result.planQty.value ?? 0), 0);
  const actualPlanQty = flat.reduce((sum, line) => sum + (line.result.actualPlanQty.value ?? 0), 0);
  const achievedQty = flat.reduce((sum, line) => sum + line.result.achievedQty.value, 0);

  return {
    id: report.id,
    date: dateKey(report.date),
    shift: report.shift,
    section: report.section,
    status: report.status,
    shiftStart: report.shiftStart.toISOString(),
    shiftHours: report.shiftHours,
    slots: shiftSlots(report.shiftHours).map((slot) => ({
      slot: slot.slot,
      minutes: slot.minutes,
      label: slotLabel(report.shift, slot),
      started: slotHasStarted(report.shiftStart, slot, now),
    })),
    remarks: report.remarks,
    supervisor: report.supervisor,
    submittedAt: report.submittedAt?.toISOString() ?? null,
    approvedAt: report.approvedAt?.toISOString() ?? null,
    approvedBy: report.approvedBy,
    machines,
    allMachines,
    totals: {
      planQty,
      actualPlanQty,
      achievedQty,
      reworkQty: flat.reduce((sum, line) => sum + line.reworkQty, 0),
      rejectionQty: flat.reduce((sum, line) => sum + line.rejectionQty, 0),
      idle,
      efficiencyPct: pctOf(achievedQty, actualPlanQty),
      utilisationPct: pctOf(achievedQty, planQty),
      machinesRunning: machines.filter((machine) =>
        machine.lines.some((line) => line.result.achievedQty.value > 0),
      ).length,
    },
    warningCount: flat.reduce(
      (sum, line) => sum + line.result.warnings.filter((w) => w.level === 'warning').length,
      0,
    ),
    lateHours: flat.reduce((sum, line) => sum + line.hours.filter((hour) => hour.late).length, 0),
    changes: report.changes.map((change) => ({
      id: change.id,
      label: change.label,
      before: change.before,
      after: change.after,
      by: change.changedBy.name,
      at: change.createdAt.toISOString(),
    })),
    can: {
      edit: canEditReport(user, report),
      submit: canSubmitReport(user, report),
      approve: canApproveReport(user, report),
    },
    viewerIsApprover: isProductionApprover(user),
  };
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export async function getReport(
  user: ProductionSubject,
  id: string,
  now: Date = new Date(),
): Promise<ReportDto> {
  const report = await loadReport(prisma, id);
  if (!canViewReport(user, report)) throw notFound('Production report');
  return toDto(report, user, now);
}

export interface ReportSummary {
  id: string;
  date: string;
  shift: ProductionShift;
  section: ProductionSection;
  status: ProductionReportStatus;
  supervisor: string;
  submittedAt: string | null;
  approvedAt: string | null;
  achievedQty: number;
  efficiencyPct: number | null;
  warningCount: number;
}

/** Reports this user may see, newest first. */
export async function listReports(
  user: ProductionSubject,
  filters: { status?: ProductionReportStatus; section?: ProductionSection } = {},
  limit = 60,
): Promise<ReportSummary[]> {
  const sections: ProductionSection[] =
    isProductionApprover(user) || isProductionViewer(user)
      ? ['CNC', 'VMC']
      : supervisorSections(user);
  if (sections.length === 0) return [];

  const reports = await prisma.productionReport.findMany({
    where: {
      section: filters.section
        ? { in: sections.filter((s) => s === filters.section) }
        : { in: sections },
      // The MD sees approved reports, and anything already submitted.
      ...(filters.status ? { status: filters.status } : {}),
    },
    orderBy: [{ date: 'desc' }, { shift: 'desc' }, { section: 'asc' }],
    take: limit,
    include: REPORT_INCLUDE,
  });

  const now = new Date();
  return Promise.all(
    reports.map(async (report) => {
      const dto = await toDto(report, user, now);
      return {
        id: dto.id,
        date: dto.date,
        shift: dto.shift,
        section: dto.section,
        status: dto.status,
        supervisor: dto.supervisor.name,
        submittedAt: dto.submittedAt,
        approvedAt: dto.approvedAt,
        achievedQty: dto.totals.achievedQty,
        efficiencyPct: dto.totals.efficiencyPct,
        warningCount: dto.warningCount,
      };
    }),
  );
}

// ---------------------------------------------------------------------------
// Opening a shift
// ---------------------------------------------------------------------------

/**
 * Opens the page for a section, shift and date, or returns the one already
 * open. A new page carries over each machine's operator and part from the
 * previous shift, so the supervisor only changes what changed.
 */
export async function openReport(
  user: ProductionSubject,
  input: OpenReportInput,
): Promise<{ id: string; created: boolean }> {
  if (!supervisorSections(user).includes(input.section)) {
    throw forbidden(`Only the ${input.section} supervisor opens this book.`);
  }

  const date = dateOnly(input.date);
  const existing = await prisma.productionReport.findUnique({
    where: { date_shift_section: { date, shift: input.shift, section: input.section } },
    select: { id: true },
  });
  if (existing) return { id: existing.id, created: false };

  const shiftStart = shiftStartFor(input.date, input.shift);
  if (shiftStart.getTime() > Date.now() + 60 * 60_000) {
    throw validationError('That shift has not started yet.');
  }

  const previous = await prisma.productionReport.findFirst({
    where: { section: input.section, shiftStart: { lt: shiftStart } },
    orderBy: { shiftStart: 'desc' },
    include: { lines: { orderBy: [{ machineId: 'asc' }, { position: 'desc' }] } },
  });

  const report = await prisma.$transaction(async (tx) => {
    const created = await tx.productionReport.create({
      data: {
        date,
        shift: input.shift,
        section: input.section,
        shiftStart,
        shiftHours: SHIFT_HOURS[input.section],
        supervisorId: user.id,
      },
    });

    // Every machine of the book is listed. The last operator and part each
    // machine had carry over; the supervisor changes only what changed, and a
    // machine left unfilled is reported as not running.
    const carried = new Map<string, NonNullable<typeof previous>['lines'][number]>();
    for (const line of previous?.lines ?? []) {
      if ((line.partLabel || line.operatorName) && !carried.has(line.machineId)) {
        carried.set(line.machineId, line);
      }
    }
    const machines = await tx.productionMachine.findMany({
      where: { section: input.section, isActive: true },
      orderBy: { sortOrder: 'asc' },
      select: { id: true },
    });
    await tx.productionLine.createMany({
      data: machines.map((machine) => {
        const line = carried.get(machine.id);
        return {
          reportId: created.id,
          machineId: machine.id,
          operatorName: line?.operatorName ?? null,
          partId: line?.partId ?? null,
          partLabel: line?.partLabel ?? null,
          operation: line?.operation ?? null,
          cycleSec: line?.cycleSec ?? null,
          loadSec: line?.loadSec ?? null,
          standardCycleSec: line?.standardCycleSec ?? null,
        };
      }),
    });
    return created;
  });

  return { id: report.id, created: true };
}

// ---------------------------------------------------------------------------
// Changing entries
// ---------------------------------------------------------------------------

async function editableReport(db: Db, user: ProductionSubject, reportId: string) {
  const report = await db.productionReport.findUnique({
    where: { id: reportId },
    select: {
      id: true,
      section: true,
      status: true,
      shift: true,
      shiftStart: true,
      shiftHours: true,
    },
  });
  if (!report || !canViewReport(user, report)) throw notFound('Production report');
  if (!canEditReport(user, report)) {
    throw invalidTransition(
      report.status === 'APPROVED'
        ? 'This report is approved and can no longer be changed.'
        : report.status === 'SUBMITTED'
          ? 'This report has been submitted. Only the approver can change it now.'
          : 'You cannot change this report.',
    );
  }
  return report;
}

/** After submission every change is recorded for the MD to see. */
async function recordChanges(
  db: Db,
  report: { id: string; status: ProductionReportStatus },
  user: ProductionSubject,
  changes: Array<{
    lineId: string | null;
    label: string;
    before: string | null;
    after: string | null;
  }>,
) {
  if (report.status === 'DRAFT') return;
  const real = changes.filter((change) => change.before !== change.after);
  if (real.length === 0) return;
  await db.productionChange.createMany({
    data: real.map((change) => ({ ...change, reportId: report.id, changedById: user.id })),
  });
  await writeAudit(db, {
    actorId: user.id,
    action: 'PRODUCTION_REPORT_EDITED',
    entityType: 'PRODUCTION_REPORT',
    entityId: report.id,
    after: real as unknown as Prisma.InputJsonValue,
  });
}

function show(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'object') return idleText(value as IdleMinutes);
  return String(value);
}

function idleText(idle: IdleMinutes): string {
  const parts = IDLE_REASONS.filter((reason) => (idle[reason] ?? 0) > 0).map(
    (reason) => `${IDLE_REASON_LABELS[reason]} ${idle[reason]} min`,
  );
  return parts.length ? parts.join(', ') : 'none';
}

async function partDefaults(db: Db, partId: string, section: ProductionSection) {
  const part = await db.productionPart.findUnique({ where: { id: partId } });
  if (!part || part.section !== section) throw validationError('Pick a part from this book.');
  return {
    partId: part.id,
    partLabel: part.partNumber ? `${part.partName} | ${part.partNumber}` : part.partName,
    operation: part.operation,
    standardCycleSec: part.standardCycleSec,
  };
}

export async function addLine(user: ProductionSubject, reportId: string, input: AddLineInput) {
  return prisma.$transaction(async (tx) => {
    const report = await editableReport(tx, user, reportId);
    const machine = await tx.productionMachine.findUnique({ where: { id: input.machineId } });
    if (!machine || machine.section !== report.section) {
      throw validationError('Pick a machine from this book.');
    }

    const part = input.partId ? await partDefaults(tx, input.partId, report.section) : null;
    const position = await tx.productionLine.count({
      where: { reportId, machineId: machine.id },
    });

    const line = await tx.productionLine.create({
      data: {
        reportId,
        machineId: machine.id,
        position,
        operatorName: input.operatorName ?? null,
        partId: part?.partId ?? null,
        partLabel: input.partLabel ?? part?.partLabel ?? null,
        operation: input.operation ?? part?.operation ?? null,
        cycleSec: input.cycleSec ?? null,
        loadSec: input.loadSec ?? null,
        standardCycleSec: part?.standardCycleSec ?? null,
      },
    });

    // A machine idle all shift: every hour is idle for the one reason.
    if (input.idleAllShift) {
      if (position > 0) throw conflict('This machine already has a line on this shift.');
      await tx.productionHour.createMany({
        data: shiftSlots(report.shiftHours).map((slot) => ({
          lineId: line.id,
          slot: slot.slot,
          qty: 0,
          idle: { [input.idleAllShift as string]: slot.minutes },
          recordedById: user.id,
        })),
      });
    }

    await recordChanges(tx, report, user, [
      {
        lineId: line.id,
        label: `${machine.code} · line added`,
        before: null,
        after: line.partLabel ?? 'idle',
      },
    ]);
    return { id: line.id };
  });
}

const LINE_FIELD_LABELS: Record<keyof UpdateLineInput, string> = {
  operatorName: 'Operator',
  partId: 'Part',
  partLabel: 'Part name',
  operation: 'Operation',
  cycleSec: 'Cycle time (s)',
  loadSec: 'Loading time (s)',
  pcsPerHourEntered: 'Pcs / hr',
  planQtyEntered: 'Plan Qty',
  actualPlanQtyEntered: 'Actual Plan Qty',
  achievedQtyEntered: 'Achieved Qty',
  runHoursEntered: 'Running hours',
  idleEntered: 'Idle time',
  reworkQty: 'Rework Qty',
  rejectionQty: 'Rejection Qty',
  ncReason: 'Reason for NC part',
  remarks: 'Remarks',
  warningNote: 'Note on warnings',
  idleAllShift: 'Idle all shift',
};

export async function updateLine(
  user: ProductionSubject,
  reportId: string,
  lineId: string,
  input: UpdateLineInput,
) {
  return prisma.$transaction(async (tx) => {
    const report = await editableReport(tx, user, reportId);
    const line = await tx.productionLine.findUnique({
      where: { id: lineId },
      include: { machine: { select: { code: true } } },
    });
    if (!line || line.reportId !== reportId) throw notFound('Line');

    const data: Prisma.ProductionLineUncheckedUpdateInput = {};
    const changes: Array<{
      lineId: string;
      label: string;
      before: string | null;
      after: string | null;
    }> = [];

    for (const key of Object.keys(input) as Array<keyof UpdateLineInput>) {
      const value = input[key];
      if (value === undefined) continue;
      if (key === 'partId' || key === 'idleAllShift') continue; // handled below
      const before = (line as Record<string, unknown>)[key];
      if (key === 'idleEntered') {
        data.idleEntered = value === null ? Prisma.DbNull : (value as Prisma.InputJsonValue);
      } else {
        (data as Record<string, unknown>)[key] = value;
      }
      changes.push({
        lineId,
        label: `${line.machine.code} · ${LINE_FIELD_LABELS[key]}`,
        before: show(before),
        after: show(value),
      });
    }

    if (input.partId !== undefined && input.partId !== line.partId) {
      if (input.partId === null) {
        data.partId = null;
        data.standardCycleSec = null;
      } else {
        const part = await partDefaults(tx, input.partId, report.section);
        data.partId = part.partId;
        data.standardCycleSec = part.standardCycleSec;
        if (input.partLabel === undefined) data.partLabel = part.partLabel;
        if (input.operation === undefined) data.operation = part.operation;
      }
      changes.push({
        lineId,
        label: `${line.machine.code} · Part`,
        before: line.partLabel,
        after: (data.partLabel as string | undefined) ?? input.partLabel ?? null,
      });
    }

    await tx.productionLine.update({ where: { id: lineId }, data });

    if (input.idleAllShift) {
      const reason = input.idleAllShift;
      const recorded = await tx.productionHour.findMany({
        where: { line: { reportId, machineId: line.machineId } },
        select: { slot: true },
      });
      if (recorded.length > 0) {
        throw conflict(
          `${line.machine.code} already has hours recorded. Record the idle time hour by hour.`,
        );
      }
      await tx.productionHour.createMany({
        data: shiftSlots(report.shiftHours).map((slot) => ({
          lineId,
          slot: slot.slot,
          qty: 0,
          idle: { [reason]: slot.minutes },
          recordedById: user.id,
        })),
      });
      changes.push({
        lineId,
        label: `${line.machine.code} · Idle all shift`,
        before: null,
        after: IDLE_REASON_LABELS[reason],
      });
    }

    await recordChanges(tx, report, user, changes);
    return { id: lineId };
  });
}

export async function deleteLine(user: ProductionSubject, reportId: string, lineId: string) {
  return prisma.$transaction(async (tx) => {
    const report = await editableReport(tx, user, reportId);
    const line = await tx.productionLine.findUnique({
      where: { id: lineId },
      include: { machine: { select: { code: true } } },
    });
    if (!line || line.reportId !== reportId) throw notFound('Line');
    const siblings = await tx.productionLine.count({
      where: { reportId, machineId: line.machineId },
    });
    if (siblings <= 1) {
      throw conflict(
        `${line.machine.code} stays on the report. Leave it unfilled if it did not run.`,
      );
    }
    await tx.productionLine.delete({ where: { id: lineId } });
    await recordChanges(tx, report, user, [
      {
        lineId: null,
        label: `${line.machine.code} · line removed`,
        before: line.partLabel ?? 'idle',
        after: null,
      },
    ]);
  });
}

export async function recordHour(
  user: ProductionSubject,
  reportId: string,
  lineId: string,
  slotNumber: number,
  input: RecordHourInput,
  now: Date = new Date(),
) {
  return prisma.$transaction(async (tx) => {
    const report = await editableReport(tx, user, reportId);
    const line = await tx.productionLine.findUnique({
      where: { id: lineId },
      include: { machine: { select: { code: true } } },
    });
    if (!line || line.reportId !== reportId) throw notFound('Line');

    const slot = shiftSlots(report.shiftHours).find((s) => s.slot === slotNumber);
    if (!slot) throw validationError('That hour is not part of this shift.');
    if (report.status === 'DRAFT' && !slotHasStarted(report.shiftStart, slot, now)) {
      throw validationError('That hour has not started yet. Record each hour as it runs.');
    }
    if (idleTotal(input.idle) > slot.minutes) {
      throw validationError(
        `Idle time cannot be more than the ${slot.minutes} minutes in this hour.`,
      );
    }

    // One machine, one record per hour: a part change splits the hours.
    const clash = await tx.productionHour.findFirst({
      where: {
        slot: slotNumber,
        line: { reportId, machineId: line.machineId },
        lineId: { not: lineId },
      },
      select: { id: true },
    });
    if (clash) {
      throw conflict(`${line.machine.code} already has this hour recorded on its other part.`);
    }

    const existing = await tx.productionHour.findUnique({
      where: { lineId_slot: { lineId, slot: slotNumber } },
    });
    await tx.productionHour.upsert({
      where: { lineId_slot: { lineId, slot: slotNumber } },
      create: {
        lineId,
        slot: slotNumber,
        qty: input.qty,
        idle: input.idle,
        note: input.note ?? null,
        recordedById: user.id,
        recordedAt: now,
      },
      update: { qty: input.qty, idle: input.idle, note: input.note ?? null },
    });

    const hourLabel = `${line.machine.code} · ${slotLabel(report.shift, slot)}`;
    await recordChanges(tx, report, user, [
      {
        lineId,
        label: `${hourLabel} quantity`,
        before: existing ? String(existing.qty) : null,
        after: String(input.qty),
      },
      {
        lineId,
        label: `${hourLabel} idle`,
        before: existing ? idleText(readIdle(existing.idle)) : null,
        after: idleText(input.idle),
      },
    ]);
  });
}

export async function clearHour(
  user: ProductionSubject,
  reportId: string,
  lineId: string,
  slotNumber: number,
) {
  return prisma.$transaction(async (tx) => {
    const report = await editableReport(tx, user, reportId);
    const hour = await tx.productionHour.findUnique({
      where: { lineId_slot: { lineId, slot: slotNumber } },
      include: { line: { include: { machine: { select: { code: true } } } } },
    });
    if (!hour || hour.line.reportId !== reportId) throw notFound('Hour');
    await tx.productionHour.delete({ where: { id: hour.id } });
    await recordChanges(tx, report, user, [
      {
        lineId,
        label: `${hour.line.machine.code} · hour ${slotNumber + 1} cleared`,
        before: String(hour.qty),
        after: null,
      },
    ]);
  });
}

export async function updateRemarks(
  user: ProductionSubject,
  reportId: string,
  remarks: string | null,
) {
  return prisma.$transaction(async (tx) => {
    const report = await editableReport(tx, user, reportId);
    const before = await tx.productionReport.findUniqueOrThrow({
      where: { id: reportId },
      select: { remarks: true },
    });
    await tx.productionReport.update({ where: { id: reportId }, data: { remarks } });
    await recordChanges(tx, report, user, [
      { lineId: null, label: 'Shift remarks', before: before.remarks, after: remarks },
    ]);
  });
}

// ---------------------------------------------------------------------------
// Submit and approve
// ---------------------------------------------------------------------------

/**
 * Hands the report to the approver. Every machine on it must have every hour
 * recorded; warnings do not block — they travel with the report.
 */
export async function submitReport(user: ProductionSubject, reportId: string, now = new Date()) {
  const report = await loadReport(prisma, reportId);
  if (!canViewReport(user, report)) throw notFound('Production report');
  if (!canSubmitReport(user, report)) {
    throw invalidTransition('Only a draft can be submitted, by the supervisor of its book.');
  }
  if (report.lines.length === 0) {
    throw validationError('Add at least one machine before submitting.');
  }

  const dto = await toDto(report, user, now);
  if (!dto.machines.some((machine) => machine.recorded)) {
    throw validationError('Record at least one machine before submitting.');
  }
  // A machine left unfilled is reported as not running; one that was started
  // must have every hour.
  const gaps = dto.machines
    .filter((machine) => machine.recorded && machine.missingSlots.length > 0)
    .map(
      (machine) =>
        `${machine.code} (${machine.missingSlots.map((s) => dto.slots[s]?.label).join(', ')})`,
    );
  if (gaps.length > 0) {
    throw validationError(`Record every hour before submitting. Missing: ${gaps.join('; ')}.`, {
      missing: gaps,
    });
  }

  await prisma.$transaction(async (tx) => {
    const updated = await tx.productionReport.updateMany({
      where: { id: reportId, status: 'DRAFT' },
      data: { status: 'SUBMITTED', submittedAt: now },
    });
    if (updated.count === 0) throw conflict('This report was submitted a moment ago.');
    await writeAudit(tx, {
      actorId: user.id,
      action: 'PRODUCTION_REPORT_SUBMITTED',
      entityType: 'PRODUCTION_REPORT',
      entityId: reportId,
      after: { warnings: dto.warningCount, achieved: dto.totals.achievedQty },
    });
  });

  await sendSubmittedMail(await getReportForMail(reportId));
}

export async function approveReport(user: ProductionSubject, reportId: string, now = new Date()) {
  const report = await loadReport(prisma, reportId);
  if (!canViewReport(user, report)) throw notFound('Production report');
  if (!canApproveReport(user, report)) {
    throw invalidTransition('Only a submitted report can be approved, by the approver.');
  }

  await prisma.$transaction(async (tx) => {
    const updated = await tx.productionReport.updateMany({
      where: { id: reportId, status: 'SUBMITTED' },
      data: { status: 'APPROVED', approvedAt: now, approvedById: user.id },
    });
    if (updated.count === 0) throw conflict('This report was approved a moment ago.');
    await writeAudit(tx, {
      actorId: user.id,
      action: 'PRODUCTION_REPORT_APPROVED',
      entityType: 'PRODUCTION_REPORT',
      entityId: reportId,
    });
  });

  await sendApprovedMail(await getReportForMail(reportId));
}

/** The report as the approver sees it, for building a mail. */
async function getReportForMail(reportId: string): Promise<ReportDto> {
  const report = await loadReport(prisma, reportId);
  const approver: ProductionSubject = {
    id: 'mail',
    email: '',
    role: 'MD',
    isActive: true,
  };
  return toDto(report, approver, new Date());
}

// ---------------------------------------------------------------------------
// Parts
// ---------------------------------------------------------------------------

export interface PartDto {
  id: string;
  customer: string | null;
  partName: string;
  partNumber: string | null;
  operation: number;
  standardCycleSec: number | null;
  addedFromFloor: boolean;
}

export async function listParts(section: ProductionSection): Promise<PartDto[]> {
  const parts = await prisma.productionPart.findMany({
    where: { section, isActive: true },
    orderBy: [{ partName: 'asc' }, { partNumber: 'asc' }, { operation: 'asc' }],
  });
  return parts.map((part) => ({
    id: part.id,
    customer: part.customer,
    partName: part.partName,
    partNumber: part.partNumber,
    operation: part.operation,
    standardCycleSec: part.standardCycleSec,
    addedFromFloor: part.addedById !== null,
  }));
}

/** A supervisor adds a part the master does not have yet; the approver sees it flagged. */
export async function addPart(user: ProductionSubject, input: AddPartInput): Promise<PartDto> {
  const mayAdd = supervisorSections(user).includes(input.section) || isProductionApprover(user);
  if (!mayAdd) throw forbidden('Only the supervisor of this book or the approver adds parts.');

  return prisma.$transaction(async (tx) => {
    const part = await tx.productionPart.create({
      data: {
        section: input.section,
        customer: input.customer ?? null,
        partName: input.partName,
        partNumber: input.partNumber ?? null,
        operation: input.operation,
        standardCycleSec: input.standardCycleSec ?? null,
        addedById: isProductionApprover(user) ? null : user.id,
      },
    });
    await writeAudit(tx, {
      actorId: user.id,
      action: 'PRODUCTION_PART_ADDED',
      entityType: 'PRODUCTION_PART',
      entityId: part.id,
      after: input as unknown as Prisma.InputJsonValue,
    });
    return {
      id: part.id,
      customer: part.customer,
      partName: part.partName,
      partNumber: part.partNumber,
      operation: part.operation,
      standardCycleSec: part.standardCycleSec,
      addedFromFloor: part.addedById !== null,
    };
  });
}

export type { ProductionWarning };
