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

describe('production report', () => {
  it('works out the book from the hours, and carries a typed-over figure as a warning to approval', async () => {
    const { id } = await openReport(cncSupervisor, { date: DATE, shift: 'DAY', section: 'CNC' });
    await addLine(cncSupervisor, id, {
      machineId,
      operatorName: 'Govind',
      partId,
      partLabel: undefined,
      cycleSec: 77,
      loadSec: 10,
    });
    let report = await getReport(cncSupervisor, id);
    const lineId = report.machines[0].lines[0].id;

    await fillShift(id, lineId);
    report = await getReport(cncSupervisor, id);
    const line = report.machines[0].lines[0];
    expect(line.result.pcsPerHour.value).toBe(41);
    expect(line.result.planQty.value).toBe(471);
    expect(line.result.runHours.value).toBe(6.5);
    expect(line.result.actualPlanQty.value).toBe(266);
    expect(line.result.achievedQty.value).toBe(236);
    expect(line.result.warnings.map((w) => w.code)).toContain('CYCLE_VS_STANDARD');

    // The supervisor insists on a different achieved figure.
    await updateLine(cncSupervisor, id, lineId, {
      achievedQtyEntered: 250,
      warningNote: 'Recount',
    });
    report = await getReport(cncSupervisor, id);
    expect(report.machines[0].lines[0].result.achievedQty).toEqual({
      computed: 236,
      value: 250,
      overridden: true,
    });

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
  });

  it('will not submit until every hour of every machine is recorded', async () => {
    const { id } = await openReport(cncSupervisor, { date: DATE, shift: 'DAY', section: 'CNC' });
    await addLine(cncSupervisor, id, {
      machineId,
      partId,
      cycleSec: 77,
      loadSec: 10,
      operatorName: null,
      partLabel: undefined,
    });
    await expect(submitReport(cncSupervisor, id)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
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
    await addLine(cncSupervisor, id, {
      machineId,
      partId,
      cycleSec: 77,
      loadSec: 10,
      operatorName: null,
      partLabel: undefined,
    });
    const lineId = (await getReport(cncSupervisor, id)).machines[0].lines[0].id;
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
});
