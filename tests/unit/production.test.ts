/**
 * The production book's arithmetic, checked against figures written in the
 * book itself (CNC page, 23/11/26, shift II; VMC page, 21/11/26, shift I).
 */
import { describe, expect, it } from 'vitest';

import {
  availableHoursByLine,
  computeLine,
  isLateEntry,
  missingSlots,
  shiftSlots,
  slotLabel,
  type HourInput,
  type LineInput,
} from '@/lib/domain/production';

function line(overrides: Partial<LineInput> = {}): LineInput {
  return {
    cycleSec: null,
    loadSec: null,
    standardCycleSec: null,
    partLinked: true,
    partAddedFromFloor: false,
    partLabel: 'Part',
    pcsPerHourEntered: null,
    planQtyEntered: null,
    actualPlanQtyEntered: null,
    achievedQtyEntered: null,
    runHoursEntered: null,
    idleEntered: null,
    reworkQty: 0,
    rejectionQty: 0,
    ncReason: null,
    ...overrides,
  };
}

/** Spreads `total` pieces and the idle minutes over hours, as a supervisor would. */
function hours(total: number, idle: HourInput['idle'] = {}, count = 12): HourInput[] {
  const out: HourInput[] = [];
  for (let slot = 0; slot < count; slot += 1) {
    const qty =
      slot === 0 ? total - Math.floor(total / count) * (count - 1) : Math.floor(total / count);
    out.push({ slot, qty, idle: slot === 0 ? idle : {} });
  }
  return out;
}

describe('the book, CNC 23/11 shift II', () => {
  it('CNC-07: 77+10=41/hr, 11.5 h, 4.5 h no operator + ¼ cleaning + ¼ others → 471 / 266 / 88.7%', () => {
    const result = computeLine(
      line({ cycleSec: 77, loadSec: 10 }),
      hours(236, { NO_OPERATOR: 270, CLEANING: 15, OTHERS: 15 }),
      11.5,
    );
    expect(result.pcsPerHour.value).toBe(41);
    expect(result.planQty.value).toBe(471);
    expect(result.runHours.value).toBe(6.5);
    expect(result.actualPlanQty.value).toBe(266);
    expect(result.achievedQty.value).toBe(236);
    expect(result.efficiencyPct).toBe(88.7);
    expect(result.warnings.filter((w) => w.level === 'warning')).toEqual([]);
  });

  it('CNC-01: 55+10=55/hr → plan 632, actual plan 605 after ½ h idle, 575 = 95%', () => {
    const result = computeLine(
      line({ cycleSec: 55, loadSec: 10 }),
      hours(575, { CLEANING: 15, OTHERS: 15 }),
      11.5,
    );
    expect(result.pcsPerHour.value).toBe(55);
    expect(result.planQty.value).toBe(632);
    expect(result.actualPlanQty.value).toBe(605);
    expect(result.efficiencyPct).toBe(95);
  });

  it('CNC-11: the book writes 514 where 45/hr × 11.5 gives 517 — a warning with both', () => {
    const result = computeLine(
      line({ cycleSec: 70, loadSec: 10, planQtyEntered: 514 }),
      hours(495, { CLEANING: 15, OTHERS: 15 }),
      11.5,
    );
    expect(result.planQty.computed).toBe(517);
    expect(result.planQty.value).toBe(514);
    const warning = result.warnings.find((w) => w.code === 'PLAN_QTY');
    expect(warning).toMatchObject({ expected: '517', entered: '514', level: 'warning' });
  });
});

describe('the book, VMC 21/11 shift I', () => {
  it('VMC-01: 64+10=48/hr over 11 h, ½ h no power + ¼ h air low → 528 / 489', () => {
    const result = computeLine(
      line({ cycleSec: 64, loadSec: 10 }),
      hours(440, { NO_POWER: 30, OTHERS: 15 }, 11),
      11,
    );
    expect(result.pcsPerHour.value).toBe(48);
    expect(result.planQty.value).toBe(528);
    expect(result.runHours.value).toBe(10.25);
    expect(result.actualPlanQty.value).toBe(492);
    expect(result.efficiencyPct).toBe(89.4);
  });
});

describe('warnings', () => {
  it('a cycle time that differs from the master says what it should be', () => {
    const result = computeLine(line({ cycleSec: 55, loadSec: 10, standardCycleSec: 40 }), [], 11.5);
    const warning = result.warnings.find((w) => w.code === 'CYCLE_VS_STANDARD');
    expect(warning?.message).toBe(
      'Cycle time should be 40 s (master) but 65 s (55+10) was entered.',
    );
  });

  it('typing over Achieved keeps both figures', () => {
    const result = computeLine(line({ cycleSec: 40, achievedQtyEntered: 950 }), hours(900), 11.5);
    expect(result.achievedQty).toEqual({ computed: 900, value: 950, overridden: true });
    expect(result.warnings.map((w) => w.code)).toContain('ACHIEVED_QTY');
  });

  it('typing the formula figure itself is not a warning', () => {
    const result = computeLine(line({ cycleSec: 40, planQtyEntered: 1035 }), hours(900), 11.5);
    expect(result.warnings.find((w) => w.code === 'PLAN_QTY')).toBeUndefined();
  });

  it('more than possible in the running hours is flagged', () => {
    const result = computeLine(line({ cycleSec: 40 }), hours(1200), 11.5);
    expect(result.warnings.map((w) => w.code)).toContain('ABOVE_PLAN');
  });

  it('changed idle hours and running hours are each flagged', () => {
    const result = computeLine(
      line({ cycleSec: 40, idleEntered: { NO_POWER: 60 }, runHoursEntered: 11 }),
      hours(800, { NO_POWER: 30 }),
      11.5,
    );
    const codes = result.warnings.map((w) => w.code);
    expect(codes).toContain('IDLE');
    expect(codes).toContain('RUN_HOURS');
  });

  it('rejection with no reason is flagged', () => {
    const result = computeLine(line({ cycleSec: 40, rejectionQty: 3 }), hours(800), 11.5);
    expect(result.warnings.map((w) => w.code)).toContain('REJECTION_NO_REASON');
  });
});

describe('the shift clock', () => {
  it('11.5 h is eleven full hours and a half', () => {
    const slots = shiftSlots(11.5);
    expect(slots).toHaveLength(12);
    expect(slots[11]).toEqual({ slot: 11, startMinute: 660, minutes: 30 });
    expect(slotLabel('DAY', slots[0])).toBe('08:30–09:30');
    expect(slotLabel('DAY', slots[11])).toBe('19:30–20:00');
    expect(slotLabel('NIGHT', slots[4])).toBe('00:00–01:00');
  });

  it('a part change splits the shift between the lines by the hours recorded', () => {
    const available = availableHoursByLine(
      [
        { id: 'a', hours: [0, 1, 2, 3].map((slot) => ({ slot })) },
        { id: 'b', hours: [4, 5, 6, 7, 8, 9, 10, 11].map((slot) => ({ slot })) },
      ],
      11.5,
    );
    expect(available.get('a')).toBe(4);
    expect(available.get('b')).toBe(7.5);
  });

  it('lists the hours no line has recorded', () => {
    expect(missingSlots([{ hours: [{ slot: 0 }, { slot: 2 }] }], 4)).toEqual([1, 3]);
  });

  it('an hour recorded more than an hour after it ended is late', () => {
    const start = new Date('2026-11-26T03:00:00Z');
    const slot = shiftSlots(11)[0];
    expect(isLateEntry(start, slot, new Date('2026-11-26T04:30:00Z'))).toBe(false);
    expect(isLateEntry(start, slot, new Date('2026-11-26T05:30:00Z'))).toBe(true);
  });
});
