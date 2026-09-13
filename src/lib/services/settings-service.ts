/**
 * Reading operator-owned settings (SDD section 3.4).
 *
 * Values live in a JSONB column so a setting can grow from a scalar to a
 * structure without a migration, which means every read has to be defensive
 * about the shape it finds. A malformed value falls back to the documented
 * default rather than throwing — a bad setting should not take the shop floor
 * offline.
 *
 * M9 adds the write side and a cache; until then reads are direct, which is
 * correct for a table of eleven rows.
 */
import { prisma } from '@/lib/db/prisma';
import { moduleLogger } from '@/lib/utils/logger';

const log = moduleLogger('settings');

export async function getSetting(key: string): Promise<unknown> {
  const row = await prisma.setting.findUnique({ where: { key } });
  return row?.value ?? undefined;
}

export async function getSettingNumber(key: string, fallback: number): Promise<number> {
  const value = await getSetting(key);

  if (typeof value === 'number' && Number.isFinite(value)) return value;

  if (value !== undefined) {
    log.warn({ key, value }, 'setting is not a number; using the default');
  }
  return fallback;
}

export async function getSettingString(key: string, fallback: string): Promise<string> {
  const value = await getSetting(key);
  if (typeof value === 'string' && value.length > 0) return value;

  if (value !== undefined) {
    log.warn({ key, value }, 'setting is not a string; using the default');
  }
  return fallback;
}

export async function getSettingBoolean(key: string, fallback: boolean): Promise<boolean> {
  const value = await getSetting(key);
  if (typeof value === 'boolean') return value;

  if (value !== undefined) {
    log.warn({ key, value }, 'setting is not a boolean; using the default');
  }
  return fallback;
}
