/**
 * Typed reads (build spec M9.1).
 *
 * Every consumer goes through these rather than touching the table, so a
 * malformed value is repaired once, here, instead of being coerced slightly
 * differently in the sweeper, the publish path and the problem form.
 *
 * A value that fails its schema falls back to the documented default and logs.
 * The alternative — throwing — means one bad row stops every reminder in the
 * system, which is a worse failure than running on the default the operator
 * had before they typed something odd.
 */
import {
  SETTING_DEFINITIONS,
  settingDefinition,
  type SettingDefinition,
} from '@/lib/domain/settings-definitions';
import { moduleLogger } from '@/lib/utils/logger';

import { loadSettings, readSetting } from './cache';

const log = moduleLogger('settings');

/** Parses one raw value against its definition, falling back on failure. */
function coerce(definition: SettingDefinition, raw: unknown): unknown {
  if (raw === undefined || raw === null) return definition.default;

  const parsed = definition.schema.safeParse(raw);
  if (parsed.success) return parsed.data;

  log.warn(
    { key: definition.key, raw, problem: parsed.error.issues[0]?.message },
    'setting failed its schema; using the documented default',
  );
  return definition.default;
}

/**
 * One setting, validated and typed.
 *
 * The generic is inferred from the definition, so `getSetting('working_days')`
 * is `number[]` and `getSetting('digest.time')` is `string` without a cast at
 * the call site.
 */
export async function getSetting(key: string): Promise<unknown> {
  const definition = settingDefinition(key);
  if (!definition) return readSetting(key);

  return coerce(definition, await readSetting(key));
}

export async function getSettingNumber(key: string, fallback: number): Promise<number> {
  const value = await getSetting(key);
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export async function getSettingString(key: string, fallback: string): Promise<string> {
  const value = await getSetting(key);
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

export async function getSettingBoolean(key: string, fallback: boolean): Promise<boolean> {
  const value = await getSetting(key);
  return typeof value === 'boolean' ? value : fallback;
}

export async function getSettingArray<T>(key: string, fallback: T[]): Promise<T[]> {
  const value = await getSetting(key);
  return Array.isArray(value) ? (value as T[]) : fallback;
}

/** What the API returns: every key, validated, with write-only values withheld. */
export interface SettingView {
  key: string;
  group: string;
  label: string;
  help: string;
  caution?: string;
  /** Absent for a write-only key. */
  value?: unknown;
  /** True when the key is stored but never returned. */
  writeOnly: boolean;
  /** Whether a value has ever been set, so the screen can say "using default". */
  isSet: boolean;
}

/** Every setting for the settings screen and `GET /api/settings`. */
export async function listSettings(): Promise<SettingView[]> {
  const raw = await loadSettings();

  return SETTING_DEFINITIONS.map((definition): SettingView => {
    const stored = raw.get(definition.key);
    const isSet = stored !== undefined && stored !== null && stored !== '';

    if (definition.writeOnly) {
      /*
       * The SMTP password is stored but never returned. An administrator can
       * replace it; nobody, administrator included, can read it back out
       * through a JSON endpoint that a browser extension or a proxy log might
       * capture.
       */
      return {
        key: definition.key,
        group: definition.group,
        label: definition.label,
        help: definition.help,
        caution: definition.caution,
        writeOnly: true,
        isSet,
      };
    }

    return {
      key: definition.key,
      group: definition.group,
      label: definition.label,
      help: definition.help,
      caution: definition.caution,
      value: coerce(definition as SettingDefinition, stored),
      writeOnly: false,
      isSet,
    };
  });
}
