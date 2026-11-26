/**
 * The daily production report end to end: a supervisor opens a shift and
 * records hours, the final report is worked out, a typed-over figure travels
 * as a warning, submission mails Planning, Planning corrects and approves,
 * and the MD is mailed.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import type { SessionUser } from '@/lib/auth/session';
import {
  addLine,
  approveReport,
  getReport,
  listReports,
  openReport,
  recordHour,
  submitReport,
  updateLine,
} from '@/lib/services/production/reports';

import { createTestUser, resetAuthTables, testDb } from './helpers/db';
import { mailsOfType, restoreMail, useCapturingMail } from './helpers/mail';

const DATE = '2026-11-20';

function asSession(
  user: Awaited<ReturnType<typeof createTestUser>>,
  productionSection: 'CNC' | 'VMC' | null = null,
): SessionUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    departmentId: user.departmentId,
    isActive: true,
    mustChangePassword: false,
    productionSection,
  };
}

let cncSupervisor: SessionUser;
let vmcSupervisor: SessionUser;
let approver: SessionUser;
let md: SessionUser;
let member: SessionUser;
let machineId: string;
let partId: string;

beforeEach(async () => {
  await resetAuthTables();
  useCapturingMail();

  cncSupervisor = asSession(
    await createTestUser({ role: 'SUPERVISOR', name: 'CNC Sup', email: 'sup.cnc@example.com' }),
    'CNC',
  );
  vmcSupervisor = asSession(
    await createTestUser({ role: 'SUPERVISOR', name: 'VMC Sup', email: 'sup.vmc@example.com' }),
    'VMC',
  );
  // Planning's login is the default approver.
  approver = asSession(
    await createTestUser({
      role: 'MEMBER',
      name: 'Dhiyaneswar S',
      email: 'marketing@jaraaglobal.in',
    }),
  );
  md = asSession(await createTestUser({ role: 'MD', name: 'MD', email: 'md@example.com' }));
  member = asSession(await createTestUser({ role: 'MEMBER', email: 'someone@example.com' }));

  const machine = await testDb.productionMachine.create({
    data: { code: 'CNC-07', section: 'CNC', sortOrder: 7 },
  });
  machineId = machine.id;
  // A second machine nobody fills in: it is pre-loaded and reported as not running.
  await testDb.productionMachine.create({ data: { code: 'CNC-08', section: 'CNC', sortOrder: 8 } });
  const part = await testDb.productionPart.create({
    data: {
      section: 'CNC',
      partName: 'Inner Metal-1',
      partNumber: 'RJ-0581-11',
      operation: 1,
      standardCycleSec: 80,
    },
  });
  partId = part.id;
});

afterAll(() => restoreMail());

async function fillShift(reportId: string, lineId: string) {
  // 11.5 h = 12 slots. 236 pieces; 4.5 h no operator, ¼ cleaning, ¼ others.
  for (let slot = 0; slot < 12; slot += 1) {
    await recordHour(
      cncSupervisor,
      reportId,
      lineId,
      slot,
      {
        qty: slot < 7 ? (slot === 0 ? 26 : 35) : 0,
        idle:
          slot === 7
            ? { NO_OPERATOR: 60 }
            : slot === 8
              ? { NO_OPERATOR: 60 }
              : slot === 9
                ? { NO_OPERATOR: 60 }
                : slot === 10
                  ? { NO_OPERATOR: 60 }
                  : slot === 11
                    ? { NO_OPERATOR: 30 }
                    : slot === 0
                      ? { CLEANING: 15, OTHERS: 15 }
                      : {},
        note: null,
      },
      new Date('2026-11-21T00:00:00Z'),
    );
  }
}

/** The pre-loaded line of CNC-07 on a report. */
async function cnc07Line(reportId: string) {
  const report = await getReport(cncSupervisor, reportId);
  const machine = report.machines.find((m) => m.code === 'CNC-07');
  if (!machine) throw new Error('CNC-07 is not on the report');
  return machine.lines[0];
}

describe('production report', () => {
  it('opens with every machine of the book listed', async () => {
    const { id } = await openReport(cncSupervisor, { date: DATE, shift: 'DAY', section: 'CNC' });
    const report = await getReport(cncSupervisor, id);
    expect(report.machines.map((m) => [m.code, m.recorded, m.lines.length])).toEqual([
      ['CNC-07', false, 1],
      ['CNC-08', false, 1],
    ]);
    expect(report.warningCount).toBe(0);
  });

  it('works out the book from the hours, and carries a typed-over figure as a warning to approval', async () => {
    const { id } = await openReport(cncSupervisor, { date: DATE, shift: 'DAY', section: 'CNC' });
    const lineId = (await cnc07Line(id)).id;
    await updateLine(cncSupervisor, id, lineId, {
      operatorName: 'Govind',
      partId,
      cycleSec: 77,
      loadSec: 10,
    });

    await fillShift(id, lineId);
    let report = await getReport(cncSupervisor, id);
    const line = await cnc07Line(id);
    expect(line.partLabel).toBe('Inner Metal-1 | RJ-0581-11');
    expect(line.result.pcsPerHour.value).toBe(41);
    expect(line.result.planQty.value).toBe(471);
    expect(line.result.runHours.value).toBe(6.5);
    expect(line.result.actualPlanQty.value).toBe(266);
    expect(line.result.achievedQty.value).toBe(236);
    expect(line.result.warnings.map((w) => w.code)).toContain('CYCLE_VS_STANDARD');
    // CNC-08 was never filled: not running, and not in the totals.
    expect(report.machines.find((m) => m.code === 'CNC-08')?.recorded).toBe(false);
    expect(report.totals.planQty).toBe(471);

    // The supervisor insists on a different achieved figure.
    await updateLine(cncSupervisor, id, lineId, {
      achievedQtyEntered: 250,
      warningNote: 'Recount',
    });
    expect((await cnc07Line(id)).result.achievedQty).toEqual({
      computed: 236,
      value: 250,
      overridden: true,
    });

    // The unfilled machine does not hold the report back.
    await submitReport(cncSupervisor, id);
    expect(mailsOfType('PRODUCTION_REPORT_SUBMITTED').map((m) => m.to)).toEqual([
      'marketing@jaraaglobal.in',
    ]);

    // The supervisor is locked out; the approver may still correct it, and it is recorded.
    await expect(updateLine(cncSupervisor, id, lineId, { reworkQty: 2 })).rejects.toMatchObject({
      code: 'INVALID_TRANSITION',
    });
    await updateLine(approver, id, lineId, { reworkQty: 2 });
    report = await getReport(approver, id);
    expect(report.changes.map((c) => [c.label, c.before, c.after, c.by])).toEqual([
      ['CNC-07 · Rework Qty', '0', '2', 'Dhiyaneswar S'],
    ]);
    const warnings = report.machines[0].lines[0].result.warnings;
    expect(warnings.find((w) => w.code === 'ACHIEVED_QTY')).toMatchObject({
      expected: '236',
      entered: '250',
    });

    await approveReport(approver, id);
    expect(mailsOfType('PRODUCTION_REPORT_APPROVED').map((m) => m.to)).toEqual(['md@example.com']);
    report = await getReport(md, id);
    expect(report.status).toBe('APPROVED');
    expect(report.can).toEqual({ edit: false, submit: false, approve: false });

    // The next shift opens with CNC-07's operator and part carried over.
    const next = await openReport(cncSupervisor, { date: DATE, shift: 'NIGHT', section: 'CNC' });
    const carried = await cnc07Line(next.id);
    expect([carried.operatorName, carried.partLabel, carried.cycleSec, carried.recorded]).toEqual([
      'Govind',
      'Inner Metal-1 | RJ-0581-11',
      77,
      false,
    ]);
  });

  it('needs something recorded, and every hour of a machine that was started', async () => {
    const { id } = await openReport(cncSupervisor, { date: DATE, shift: 'DAY', section: 'CNC' });
    await expect(submitReport(cncSupervisor, id)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'Record at least one machine before submitting.',
    });

    const lineId = (await cnc07Line(id)).id;
    await recordHour(
      cncSupervisor,
      id,
      lineId,
      0,
      { qty: 30, idle: {}, note: null },
      new Date('2026-11-21T00:00:00Z'),
    );
    await expect(submitReport(cncSupervisor, id)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
  });

  it('marks a machine idle for the whole shift from its set-up', async () => {
    const { id } = await openReport(cncSupervisor, { date: DATE, shift: 'DAY', section: 'CNC' });
    const lineId = (await cnc07Line(id)).id;
    await updateLine(cncSupervisor, id, lineId, {
      idleAllShift: 'NO_LOAD',
      remarks: 'No material',
    });
    const line = await cnc07Line(id);
    expect(line.recorded).toBe(true);
    expect(line.result.idleHours).toBe(11.5);
    expect(line.result.idle.value).toEqual({ NO_LOAD: 690 });
    await submitReport(cncSupervisor, id);
  });

  it('keeps each person to their part of it', async () => {
    await expect(
      openReport(vmcSupervisor, { date: DATE, shift: 'DAY', section: 'CNC' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    const { id } = await openReport(cncSupervisor, { date: DATE, shift: 'DAY', section: 'CNC' });
    await expect(getReport(vmcSupervisor, id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(getReport(member, id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await listReports(member)).toEqual([]);
    await expect(approveReport(approver, id)).rejects.toMatchObject({
      code: 'INVALID_TRANSITION',
    });
    expect((await listReports(md)).map((r) => r.id)).toEqual([id]);
  });

  it('does not let an hour be recorded before it starts', async () => {
    const { id } = await openReport(cncSupervisor, { date: DATE, shift: 'DAY', section: 'CNC' });
    const lineId = (await cnc07Line(id)).id;
    await expect(
      recordHour(
        cncSupervisor,
        id,
        lineId,
        5,
        { qty: 10, idle: {}, note: null },
        new Date('2026-11-20T04:00:00Z'),
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('adds a second line on a machine for a part change', async () => {
    const { id } = await openReport(cncSupervisor, { date: DATE, shift: 'DAY', section: 'CNC' });
    await addLine(cncSupervisor, id, { machineId, partId, cycleSec: 77, loadSec: 10 });
    const report = await getReport(cncSupervisor, id);
    expect(report.machines.find((m) => m.code === 'CNC-07')?.lines).toHaveLength(2);
  });
});
