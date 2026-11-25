/**
 * The arithmetic of the daily production book (JGE/PROD/F/03).
 *
 * Read off the handwritten pages and the capacity workbook, and checked
 * against both:
 *
 *   "77+10=41"     machining 77 s + loading 10 s = 87 s, so 3600 / 87 = 41 pcs/hr
 *   Plan Qty       pcs/hr x the shift's hours          41 x 11.5 = 471
 *   Hrs            shift hours - every idle hour       11.5 - 5 = 6.5
 *   Actual Plan    pcs/hr x running hours              41 x 6.5 = 266
 *   Percentage     Achieved / Actual Plan              236 / 266 = 88 %
 *
 * The workbook's "Efficiency %" is Achieved / Plan Qty (idle time counted as a
 * loss); its "Plan Achievement %" is the book's percentage. Both are shown.
 *
 * Every figure is worked out from the hourly entries. A figure the supervisor
 * types over it is kept, and {@link computeLine} reports it as a warning with
 * the expected and the entered value, so the approver sees both. Pure: no
 * database, no clock.
 */

export type ProductionSectionValue = 'CNC' | 'VMC';
export type ProductionShiftValue = 'DAY' | 'NIGHT';

// ---------------------------------------------------------------------------
// Shifts
// ---------------------------------------------------------------------------

/**
 * When each shift starts (IST minutes after midnight) and how many hours it is
 * planned for. CNC plans 11.5 hours and VMC 11, as the book and the workbook
 * do. The night start is provisional until the lunch break is confirmed.
 */
export const SHIFT_START_MINUTES: Record<ProductionShiftValue, number> = {
  DAY: 8 * 60 + 30,
  NIGHT: 20 * 60,
};

export const SHIFT_HOURS: Record<ProductionSectionValue, number> = {
  CNC: 11.5,
  VMC: 11,
};

export interface ShiftSlot {
  slot: number;
  /** Minutes after the shift start. */
  startMinute: number;
  minutes: number;
}

/** One-hour slots; the last one is shorter when the shift is not whole hours. */
export function shiftSlots(shiftHours: number): ShiftSlot[] {
  const total = Math.round(shiftHours * 60);
  const slots: ShiftSlot[] = [];
  for (let start = 0, slot = 0; start < total; start += 60, slot += 1) {
    slots.push({ slot, startMinute: start, minutes: Math.min(60, total - start) });
  }
  return slots;
}

/** "08:30" style wall-clock label, from the shift's IST start minute. */
export function clockLabel(minuteOfDay: number): string {
  const m = ((minuteOfDay % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60);
  const min = m % 60;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

export function slotLabel(shift: ProductionShiftValue, slot: ShiftSlot): string {
  const start = SHIFT_START_MINUTES[shift] + slot.startMinute;
  return `${clockLabel(start)}–${clockLabel(start + slot.minutes)}`;
}

// ---------------------------------------------------------------------------
// Machines, operations, idle reasons
// ---------------------------------------------------------------------------

/** The machines in each book, in the book's order. */
export const BOOK_MACHINES: Record<ProductionSectionValue, string[]> = {
  CNC: [
    ...Array.from({ length: 22 }, (_, i) => `CNC-${String(i + 1).padStart(2, '0')}`),
    'TMC-01',
    'DRILLING-01',
    'DRILLING-02',
    'THREAD ROLLING-01',
  ],
  VMC: Array.from({ length: 10 }, (_, i) => `VMC-${String(i + 1).padStart(2, '0')}`),
};

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI'];

/** 2 → "II". */
export function operationLabel(operation: number | null | undefined): string {
  if (!operation) return '—';
  return ROMAN[operation - 1] ?? String(operation);
}

/** The book's idle columns, in the book's order. */
export const IDLE_REASONS = [
  'SETTING',
  'NO_POWER',
  'NO_OPERATOR',
  'NO_LOAD',
  'BREAKDOWN',
  'DEVELOPMENT',
  'MATERIAL',
  'MEETING',
  'LOADING_UNLOADING',
  'CLEANING',
  'QC_APPROVAL',
  'OTHERS',
] as const;

export type IdleReason = (typeof IDLE_REASONS)[number];

export const IDLE_REASON_LABELS: Record<IdleReason, string> = {
  SETTING: 'Setting',
  NO_POWER: 'No Power',
  NO_OPERATOR: 'No Operator',
  NO_LOAD: 'No Load',
  BREAKDOWN: 'Machine Breakdown',
  DEVELOPMENT: 'Development',
  MATERIAL: 'Material Problem',
  MEETING: 'Meeting',
  LOADING_UNLOADING: 'Loading & Unloading',
  CLEANING: 'Machine Cleaning',
  QC_APPROVAL: 'QC Approval',
  OTHERS: 'Others',
};

export type IdleMinutes = Partial<Record<IdleReason, number>>;

/** Reads a stored idle map, dropping unknown reasons and non-positive minutes. */
export function readIdle(value: unknown): IdleMinutes {
  const out: IdleMinutes = {};
  if (!value || typeof value !== 'object') return out;
  for (const reason of IDLE_REASONS) {
    const minutes = (value as Record<string, unknown>)[reason];
    if (typeof minutes === 'number' && Number.isFinite(minutes) && minutes > 0) {
      out[reason] = minutes;
    }
  }
  return out;
}

export function addIdle(a: IdleMinutes, b: IdleMinutes): IdleMinutes {
  const out: IdleMinutes = { ...a };
  for (const reason of IDLE_REASONS) {
    const add = b[reason] ?? 0;
    if (add > 0) out[reason] = (out[reason] ?? 0) + add;
  }
  return out;
}

export function idleTotal(idle: IdleMinutes): number {
  return IDLE_REASONS.reduce((sum, reason) => sum + (idle[reason] ?? 0), 0);
}

/** 90 → "1.5 h", 15 → "0.25 h". */
export function formatHours(hours: number): string {
  const rounded = Math.round(hours * 100) / 100;
  return `${rounded} h`;
}

// ---------------------------------------------------------------------------
// One line
// ---------------------------------------------------------------------------

export interface LineInput {
  cycleSec: number | null;
  loadSec: number | null;
  standardCycleSec: number | null;
  partLinked: boolean;
  partAddedFromFloor: boolean;
  partLabel: string | null;
  pcsPerHourEntered: number | null;
  planQtyEntered: number | null;
  actualPlanQtyEntered: number | null;
  achievedQtyEntered: number | null;
  runHoursEntered: number | null;
  idleEntered: IdleMinutes | null;
  reworkQty: number;
  rejectionQty: number;
  ncReason: string | null;
}

export interface HourInput {
  slot: number;
  qty: number;
  idle: IdleMinutes;
}

export type WarningCode =
  | 'CYCLE_VS_STANDARD'
  | 'NO_STANDARD'
  | 'PART_NOT_IN_MASTER'
  | 'NEW_PART'
  | 'PCS_PER_HOUR'
  | 'PLAN_QTY'
  | 'ACTUAL_PLAN_QTY'
  | 'ACHIEVED_QTY'
  | 'RUN_HOURS'
  | 'IDLE'
  | 'ABOVE_PLAN'
  | 'REJECTION_NO_REASON'
  | 'MISSING_HOURS'
  | 'LATE_HOURS';

export interface ProductionWarning {
  code: WarningCode;
  /** "warning" is a figure that goes against the formula; "info" is context. */
  level: 'warning' | 'info';
  message: string;
  expected?: string;
  entered?: string;
}

/** A figure on the final report: what the hours give, and what is shown. */
export interface Figure<T> {
  computed: T;
  value: T;
  overridden: boolean;
}

export interface LineResult {
  availableHours: number;
  cycleTotalSec: number | null;
  pcsPerHour: Figure<number | null>;
  planQty: Figure<number | null>;
  actualPlanQty: Figure<number | null>;
  achievedQty: Figure<number>;
  idle: Figure<IdleMinutes>;
  idleHours: number;
  runHours: Figure<number>;
  /** Achieved / Actual Plan: the book's percentage. */
  efficiencyPct: number | null;
  /** Achieved / Plan Qty: the workbook's Efficiency %. */
  utilisationPct: number | null;
  warnings: ProductionWarning[];
}

function figure<T>(computed: T, entered: T | null | undefined): Figure<T> {
  const overridden = entered !== null && entered !== undefined;
  return { computed, value: overridden ? (entered as T) : computed, overridden };
}

/** Floor that ignores floating-point dust: 41 x 6.5 must give 266, not 265. */
function floorQty(value: number): number {
  return Math.floor(value + 1e-6);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function pct(numerator: number, denominator: number | null): number | null {
  if (!denominator || denominator <= 0) return null;
  return Math.round((numerator / denominator) * 1000) / 10;
}

function secLabel(cycle: number | null, load: number | null): string {
  const total = (cycle ?? 0) + (load ?? 0);
  if (load) return `${total} s (${cycle ?? 0}+${load})`;
  return `${total} s`;
}

/**
 * Works out one line's final-report figures and the warnings against them.
 *
 * @param availableHours The hours this line had: the whole shift for a
 *   machine that ran one part, or the hours recorded on this line when the
 *   part changed mid-shift.
 */
export function computeLine(
  line: LineInput,
  hours: readonly HourInput[],
  availableHours: number,
): LineResult {
  const warnings: ProductionWarning[] = [];

  const cycleTotal =
    line.cycleSec !== null || line.loadSec !== null
      ? (line.cycleSec ?? 0) + (line.loadSec ?? 0)
      : null;

  // --- Cycle time against the master ---------------------------------------
  if (line.partLabel && !line.partLinked) {
    warnings.push({
      code: 'PART_NOT_IN_MASTER',
      level: 'info',
      message: `"${line.partLabel}" is not in the Cycle Time Master.`,
    });
  }
  if (line.partAddedFromFloor) {
    warnings.push({
      code: 'NEW_PART',
      level: 'info',
      message: `"${line.partLabel ?? 'This part'}" was added to the master by the supervisor.`,
    });
  }
  if (cycleTotal !== null && line.standardCycleSec) {
    if (Math.abs(cycleTotal - line.standardCycleSec) >= 1) {
      warnings.push({
        code: 'CYCLE_VS_STANDARD',
        level: 'warning',
        message: `Cycle time should be ${line.standardCycleSec} s (master) but ${secLabel(line.cycleSec, line.loadSec)} was entered.`,
        expected: `${line.standardCycleSec} s`,
        entered: secLabel(line.cycleSec, line.loadSec),
      });
    }
  } else if (line.partLinked && !line.standardCycleSec) {
    warnings.push({
      code: 'NO_STANDARD',
      level: 'info',
      message: 'The master has no standard cycle time for this part and operation.',
    });
  }

  // --- Pieces per hour ------------------------------------------------------
  const pcsComputed = cycleTotal && cycleTotal > 0 ? floorQty(3600 / cycleTotal) : null;
  const pcsPerHour = figure<number | null>(pcsComputed, line.pcsPerHourEntered);
  if (pcsPerHour.overridden && pcsPerHour.value !== pcsComputed) {
    warnings.push({
      code: 'PCS_PER_HOUR',
      level: 'warning',
      message:
        pcsComputed === null
          ? `Pieces per hour entered as ${pcsPerHour.value} with no cycle time.`
          : `Pieces per hour should be ${pcsComputed} (3600 ÷ ${cycleTotal} s) but ${pcsPerHour.value} was entered.`,
      expected: pcsComputed === null ? undefined : String(pcsComputed),
      entered: String(pcsPerHour.value),
    });
  }
  const pcs = pcsPerHour.value;

  // --- Idle and running hours -----------------------------------------------
  const idleFromHours = hours.reduce<IdleMinutes>((sum, hour) => addIdle(sum, hour.idle), {});
  const idle = figure<IdleMinutes>(idleFromHours, line.idleEntered);
  if (idle.overridden) {
    for (const reason of IDLE_REASONS) {
      const expected = idleFromHours[reason] ?? 0;
      const entered = idle.value[reason] ?? 0;
      if (expected !== entered) {
        warnings.push({
          code: 'IDLE',
          level: 'warning',
          message: `${IDLE_REASON_LABELS[reason]} idle should be ${formatHours(expected / 60)} from the hourly entries but ${formatHours(entered / 60)} was entered.`,
          expected: formatHours(expected / 60),
          entered: formatHours(entered / 60),
        });
      }
    }
  }
  const idleHours = idleTotal(idle.value) / 60;

  const runComputed = round2(Math.max(0, availableHours - idleHours));
  const runHours = figure<number>(runComputed, line.runHoursEntered);
  if (runHours.overridden && Math.abs(runHours.value - runComputed) > 0.01) {
    warnings.push({
      code: 'RUN_HOURS',
      level: 'warning',
      message: `Running hours should be ${formatHours(runComputed)} (${formatHours(availableHours)} − ${formatHours(idleHours)} idle) but ${formatHours(runHours.value)} was entered.`,
      expected: formatHours(runComputed),
      entered: formatHours(runHours.value),
    });
  }

  // --- Plan quantities ------------------------------------------------------
  const planComputed = pcs === null ? null : floorQty(pcs * availableHours);
  const planQty = figure<number | null>(planComputed, line.planQtyEntered);
  if (planQty.overridden && planQty.value !== planComputed) {
    warnings.push({
      code: 'PLAN_QTY',
      level: 'warning',
      message:
        planComputed === null
          ? `Plan Qty entered as ${planQty.value} with no cycle time.`
          : `Plan Qty should be ${planComputed} (${pcs}/hr × ${formatHours(availableHours)}) but ${planQty.value} was entered.`,
      expected: planComputed === null ? undefined : String(planComputed),
      entered: String(planQty.value),
    });
  }

  const actualComputed = pcs === null ? null : floorQty(pcs * runHours.value);
  const actualPlanQty = figure<number | null>(actualComputed, line.actualPlanQtyEntered);
  if (actualPlanQty.overridden && actualPlanQty.value !== actualComputed) {
    warnings.push({
      code: 'ACTUAL_PLAN_QTY',
      level: 'warning',
      message:
        actualComputed === null
          ? `Actual Plan Qty entered as ${actualPlanQty.value} with no cycle time.`
          : `Actual Plan Qty should be ${actualComputed} (${pcs}/hr × ${formatHours(runHours.value)} running) but ${actualPlanQty.value} was entered.`,
      expected: actualComputed === null ? undefined : String(actualComputed),
      entered: String(actualPlanQty.value),
    });
  }

  // --- Achieved -------------------------------------------------------------
  const achievedComputed = hours.reduce((sum, hour) => sum + hour.qty, 0);
  const achievedQty = figure<number>(achievedComputed, line.achievedQtyEntered);
  if (achievedQty.overridden && achievedQty.value !== achievedComputed) {
    warnings.push({
      code: 'ACHIEVED_QTY',
      level: 'warning',
      message: `Achieved Qty should be ${achievedComputed} (sum of the hourly entries) but ${achievedQty.value} was entered.`,
      expected: String(achievedComputed),
      entered: String(achievedQty.value),
    });
  }

  if (actualPlanQty.value !== null && achievedQty.value > actualPlanQty.value) {
    warnings.push({
      code: 'ABOVE_PLAN',
      level: 'warning',
      message: `Achieved ${achievedQty.value} is more than the ${actualPlanQty.value} possible in the running hours. Check the cycle time.`,
    });
  }

  if (line.rejectionQty > 0 && !line.ncReason?.trim()) {
    warnings.push({
      code: 'REJECTION_NO_REASON',
      level: 'warning',
      message: `${line.rejectionQty} rejected with no reason for the NC part.`,
    });
  }

  return {
    availableHours,
    cycleTotalSec: cycleTotal,
    pcsPerHour,
    planQty,
    actualPlanQty,
    achievedQty,
    idle,
    idleHours: round2(idleHours),
    runHours,
    efficiencyPct: pct(achievedQty.value, actualPlanQty.value),
    utilisationPct: pct(achievedQty.value, planQty.value),
    warnings,
  };
}

// ---------------------------------------------------------------------------
// The machine's hours across its lines
// ---------------------------------------------------------------------------

/**
 * Hours each line of one machine had. One line gets the whole shift; when the
 * part changed, each line gets the slots recorded on it.
 */
export function availableHoursByLine(
  lines: ReadonlyArray<{ id: string; hours: ReadonlyArray<{ slot: number }> }>,
  shiftHours: number,
): Map<string, number> {
  const out = new Map<string, number>();
  if (lines.length === 1) {
    out.set(lines[0].id, shiftHours);
    return out;
  }
  const minutesBySlot = new Map(shiftSlots(shiftHours).map((s) => [s.slot, s.minutes]));
  for (const line of lines) {
    const minutes = line.hours.reduce((sum, hour) => sum + (minutesBySlot.get(hour.slot) ?? 0), 0);
    out.set(line.id, minutes / 60);
  }
  return out;
}

/**
 * Slots of the shift that no line of this machine has recorded.
 */
export function missingSlots(
  lines: ReadonlyArray<{ hours: ReadonlyArray<{ slot: number }> }>,
  shiftHours: number,
): number[] {
  const recorded = new Set(lines.flatMap((line) => line.hours.map((hour) => hour.slot)));
  return shiftSlots(shiftHours)
    .map((s) => s.slot)
    .filter((slot) => !recorded.has(slot));
}

/** An hour recorded more than this long after it ended is shown as late. */
export const LATE_AFTER_MINUTES = 60;

/**
 * Whether an hour was recorded late: more than an hour after the slot ended.
 */
export function isLateEntry(shiftStart: Date, slot: ShiftSlot, recordedAt: Date): boolean {
  const slotEnd = shiftStart.getTime() + (slot.startMinute + slot.minutes) * 60_000;
  return recordedAt.getTime() - slotEnd > LATE_AFTER_MINUTES * 60_000;
}

/** Whether a slot has started, so it may be recorded. */
export function slotHasStarted(shiftStart: Date, slot: ShiftSlot, now: Date): boolean {
  return now.getTime() >= shiftStart.getTime() + slot.startMinute * 60_000;
}
