/**
 * The settings cache (build spec M9.1).
 *
 * Eleven rows read on every sweep, every publish and every problem report. A
 * 60-second TTL turns that into one query a minute, and the write path clears
 * it so an administrator's change takes effect on the next request rather than
 * up to a minute later — a settings screen that appears to do nothing for a
 * minute is a settings screen people change twice.
 *
 * The cache is per-process. With the app and the worker in separate processes
 * the worker can be up to sixty seconds stale after a change, which is fine:
 * no setting here needs to be consistent to the second, and the alternative is
 * a cache-invalidation message bus for a table of eleven rows.
 */
import { prisma } from '@/lib/db/prisma';
import { settingDefaults } from '@/lib/domain/settings-definitions';
import { moduleLogger } from '@/lib/utils/logger';

const log = moduleLogger('settings');

/** SDD-free choice: long enough to matter, short enough that staleness never does. */
export const SETTINGS_TTL_MS = 60_000;

interface CacheEntry {
  values: Map<string, unknown>;
  loadedAt: number;
}

/**
 * Survives hot reload in development, like the Prisma client, so a module
 * refresh does not silently start a second cache with different contents.
 */
const globalForSettings = globalThis as unknown as { jtasSettings?: CacheEntry | null };

/** Injectable so tests can advance time without waiting sixty seconds. */
let now: () => number = () => Date.now();

export function setSettingsClock(clock: () => number): void {
  now = clock;
}

/** Empties the cache. Called by every write, and by tests. */
export function invalidateSettings(): void {
  globalForSettings.jtasSettings = null;
}

/**
 * Every setting, from cache when it is fresh.
 *
 * A key with no row falls back to its documented default, so a database that
 * predates a new setting behaves as the code expects rather than as `undefined`.
 */
export async function loadSettings(): Promise<Map<string, unknown>> {
  const cached = globalForSettings.jtasSettings;

  if (cached && now() - cached.loadedAt < SETTINGS_TTL_MS) {
    return cached.values;
  }

  const values = new Map<string, unknown>(Object.entries(settingDefaults()));

  try {
    for (const row of await prisma.setting.findMany()) {
      values.set(row.key, row.value);
    }
  } catch (error) {
    /*
     * A database blip must not take the shop floor offline. Serving documented
     * defaults is wrong in a small way; throwing here would stop the sweeper,
     * which is wrong in a large one.
     */
    log.error({ err: error }, 'could not read settings; using defaults for this request');
    return values;
  }

  globalForSettings.jtasSettings = { values, loadedAt: now() };
  return values;
}

/** One raw value, from cache. */
export async function readSetting(key: string): Promise<unknown> {
  return (await loadSettings()).get(key);
}

/** Whether the cache currently holds anything, for tests and the health check. */
export function settingsCacheAge(): number | null {
  const cached = globalForSettings.jtasSettings;
  return cached ? now() - cached.loadedAt : null;
}
