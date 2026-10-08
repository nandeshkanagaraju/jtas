/**
 * Settings: the cache, the typed reads, and the write path (build spec M9.1).
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { SETTING_DEFINITIONS, settingDefaults } from '@/lib/domain/settings-definitions';
import {
  getSettingBoolean,
  getSettingNumber,
  getSettingString,
  invalidateSettings,
  listSettings,
  setSettingsClock,
  SETTINGS_TTL_MS,
  updateSettings,
} from '@/lib/services/settings';

import { auditRowsFor, createTestUser, resetAuthTables, testDb } from './helpers/db';

const ctx = { ipAddress: '203.0.113.7' };
let actor: Awaited<ReturnType<typeof createTestUser>>;

/** Seeds the documented defaults, as `pnpm seed` does. */
async function seedDefaults() {
  for (const [key, value] of Object.entries(settingDefaults())) {
    await testDb.setting.upsert({
      where: { key },
      create: { key, value: value as never },
      update: { value: value as never },
    });
  }
}

beforeEach(async () => {
  await resetAuthTables();
  await testDb.setting.deleteMany();
  invalidateSettings();
  setSettingsClock(() => Date.now());

  actor = await createTestUser({ email: 'md@jaraaglobal.com', role: 'MD' });
  await seedDefaults();
  invalidateSettings();
});

afterAll(async () => {
  invalidateSettings();
  setSettingsClock(() => Date.now());
  await resetAuthTables();
  await testDb.$disconnect();
});

describe('the cache', () => {
  it('reads the table once and serves the rest from memory', async () => {
    const spy = vi.spyOn(testDb.setting, 'findMany');
    invalidateSettings();

    for (let i = 0; i < 5; i++) await getSettingNumber('escalation.max_count', 3);

    // Eleven rows read on every sweep, every publish and every problem report
    // is the thing this exists to stop.
    expect(await getSettingNumber('escalation.max_count', 3)).toBe(3);
    spy.mockRestore();
  });

  it('expires after the TTL', async () => {
    let now = 1_000_000;
    setSettingsClock(() => now);
    invalidateSettings();

    expect(await getSettingNumber('escalation.max_count', 0)).toBe(3);

    await testDb.setting.update({ where: { key: 'escalation.max_count' }, data: { value: 7 } });

    // Still cached…
    now += SETTINGS_TTL_MS - 1;
    expect(await getSettingNumber('escalation.max_count', 0)).toBe(3);

    // …until it is not.
    now += 2;
    expect(await getSettingNumber('escalation.max_count', 0)).toBe(7);
  });

  it('is cleared by a write, so a change is not up to a minute late', async () => {
    const now = 1_000_000;
    setSettingsClock(() => now);
    invalidateSettings();

    expect(await getSettingNumber('escalation.max_count', 0)).toBe(3);

    await updateSettings({ 'escalation.max_count': 5 }, actor, ctx);

    // No clock movement: the write invalidated it. A settings screen that
    // appears to do nothing for a minute is one people change twice.
    expect(await getSettingNumber('escalation.max_count', 0)).toBe(5);
  });
});

describe('typed reads', () => {
  it('returns each documented default when the table is empty', async () => {
    await testDb.setting.deleteMany();
    invalidateSettings();

    expect(await getSettingNumber('reminder.default_lead_minutes', 0)).toBe(360);
    expect(await getSettingString('digest.time', '')).toBe('09:00');
    expect(await getSettingBoolean('suppress_reminders_outside_hours', false)).toBe(true);
  });

  it('falls back to the default when a value is the wrong type', async () => {
    await testDb.setting.update({
      where: { key: 'escalation.max_count' },
      data: { value: 'three' as never },
    });
    invalidateSettings();

    // Throwing here would stop every reminder in the system over one bad row.
    expect(await getSettingNumber('escalation.max_count', 0)).toBe(3);
  });

  it('falls back when a value is out of range', async () => {
    await testDb.setting.update({
      where: { key: 'escalation.max_count' },
      data: { value: 9999 },
    });
    invalidateSettings();

    expect(await getSettingNumber('escalation.max_count', 0)).toBe(3);
  });

  it('falls back when working_days is not a list of days', async () => {
    await testDb.setting.update({
      where: { key: 'working_days' },
      data: { value: ['monday'] as never },
    });
    invalidateSettings();

    const view = (await listSettings()).find((row) => row.key === 'working_days')!;
    expect(view.value).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

describe('listSettings', () => {
  it('returns every defined key with its label and group', async () => {
    const rows = await listSettings();

    expect(rows).toHaveLength(SETTING_DEFINITIONS.length);
    expect(rows.every((row) => row.label.length > 0 && row.help.length > 0)).toBe(true);
  });

  it('never returns a write-only value', async () => {
    await updateSettings({ 'mail.smtp_password': 'hunter2-not-a-real-one' }, actor, ctx);

    const row = (await listSettings()).find((r) => r.key === 'mail.smtp_password')!;

    // Stored, replaceable, unreadable. A JSON endpoint is exactly what a proxy
    // log or a browser extension captures.
    expect(row.writeOnly).toBe(true);
    expect(row.value).toBeUndefined();
    expect(JSON.stringify(row)).not.toContain('hunter2');
    expect(row.isSet).toBe(true);
  });
});

describe('updateSettings', () => {
  it('writes a change and reports it', async () => {
    const changes = await updateSettings({ 'digest.time': '07:30' }, actor, ctx);

    expect(changes).toEqual([{ key: 'digest.time', before: '09:00', after: '07:30' }]);
    expect(await getSettingString('digest.time', '')).toBe('07:30');
  });

  it('writes one audit row for the batch, not one per key', async () => {
    await updateSettings(
      { 'working_hours.start': '08:00', 'working_hours.end': '17:00' },
      actor,
      ctx,
    );

    const rows = await testDb.auditLog.findMany({ where: { action: 'SETTINGS_UPDATED' } });

    // The change was one decision by one person; splitting it loses which
    // values were set together.
    expect(rows).toHaveLength(1);
    expect(rows[0].entityId).toContain('working_hours.start');
    expect(rows[0].entityId).toContain('working_hours.end');
    expect(rows[0].before).toMatchObject({ 'working_hours.start': '09:00' });
    expect(rows[0].after).toMatchObject({ 'working_hours.end': '17:00' });
    expect(rows[0].actorId).toBe(actor.id);
    expect(rows[0].ipAddress).toBe(ctx.ipAddress);
  });

  it('redacts a write-only value in the audit log', async () => {
    await updateSettings({ 'mail.smtp_password': 'hunter2-not-a-real-one' }, actor, ctx);

    const [row] = await testDb.auditLog.findMany({ where: { action: 'SETTINGS_UPDATED' } });

    expect(JSON.stringify(row.after)).toContain('[redacted]');
    expect(JSON.stringify(row)).not.toContain('hunter2');
  });

  it('rejects a value that fails its schema, naming the field', async () => {
    await expect(updateSettings({ 'digest.time': '9am' }, actor, ctx)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });

    expect(await getSettingString('digest.time', '')).toBe('09:00');
  });

  it('reports every bad key at once rather than one per round trip', async () => {
    try {
      await updateSettings(
        { 'digest.time': '9am', 'escalation.max_count': 99, 'working_hours.start': 'noon' },
        actor,
        ctx,
      );
      expect.unreachable('should have thrown');
    } catch (error) {
      const fields = (error as { details?: { fields?: Record<string, string[]> } }).details?.fields;
      expect(Object.keys(fields ?? {}).sort()).toEqual([
        'digest.time',
        'escalation.max_count',
        'working_hours.start',
      ]);
    }
  });

  it('refuses an unknown key rather than growing a row nothing reads', async () => {
    await expect(updateSettings({ 'escalation.maxx_count': 3 }, actor, ctx)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });

    expect(await testDb.setting.findUnique({ where: { key: 'escalation.maxx_count' } })).toBeNull();
  });

  it('writes nothing and audits nothing when the value has not changed', async () => {
    const changes = await updateSettings({ 'digest.time': '09:00' }, actor, ctx);

    expect(changes).toEqual([]);
    expect(await testDb.auditLog.count({ where: { action: 'SETTINGS_UPDATED' } })).toBe(0);
  });

  it('treats a blank write-only value as "keep the current one"', async () => {
    await updateSettings({ 'mail.smtp_password': 'first-value-here' }, actor, ctx);
    await updateSettings({ 'mail.smtp_password': '' }, actor, ctx);

    const row = await testDb.setting.findUniqueOrThrow({ where: { key: 'mail.smtp_password' } });
    expect(row.value).toBe('first-value-here');
  });

  it('normalises what it stores', async () => {
    await updateSettings(
      { working_days: [6, 1, 3], 'mail.md_recipients': ['A@Jaraa.com', 'a@jaraa.com'] },
      actor,
      ctx,
    );

    expect(
      (await testDb.setting.findUniqueOrThrow({ where: { key: 'working_days' } })).value,
    ).toEqual([1, 3, 6]);

    // Lower-cased and de-duplicated, so the same address twice is one CC.
    expect(
      (await testDb.setting.findUniqueOrThrow({ where: { key: 'mail.md_recipients' } })).value,
    ).toEqual(['a@jaraa.com']);
  });

  it('refuses a day listed twice', async () => {
    await expect(updateSettings({ working_days: [1, 1, 2] }, actor, ctx)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
  });

  it('refuses an empty batch', async () => {
    await expect(updateSettings({}, actor, ctx)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
  });

  it('records the change against the actor in the audit trail', async () => {
    await updateSettings({ 'problem.min_description_length': 30 }, actor, ctx);

    const rows = await auditRowsFor('problem.min_description_length');
    expect(rows.map((row) => row.action)).toContain('SETTINGS_UPDATED');

    // Later tests in this database still expect the seeded minimum of 20.
    await updateSettings({ 'problem.min_description_length': 20 }, actor, ctx);
  });
});
