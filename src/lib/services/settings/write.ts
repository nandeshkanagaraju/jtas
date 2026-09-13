/**
 * Writing settings (build spec M9.1).
 *
 * Every write validates against the key's schema, records an audit row inside
 * the same transaction, and clears the cache.
 *
 * Nothing here rewrites work that is already scheduled. Changing the default
 * reminder lead time moves the reminder on subtasks published from now on; a
 * subtask whose reminder is already sitting in the queue keeps the time it was
 * given. That is the honest behaviour — a member told "you will be reminded at
 * noon" should be reminded at noon — and it is stated on the screen rather than
 * left for somebody to discover.
 */
import type { Prisma } from '@prisma/client';

import { prisma } from '@/lib/db/prisma';
import { settingDefinition } from '@/lib/domain/settings-definitions';
import { validationError } from '@/lib/errors';
import { writeAudit } from '@/lib/services/audit-service';
import { moduleLogger } from '@/lib/utils/logger';

import { invalidateSettings, loadSettings } from './cache';

const log = moduleLogger('settings');

export interface SettingsActor {
  id: string;
}

export interface UpdateSettingsContext {
  ipAddress: string | null;
}

/** What changed, for the response and the audit row. */
export interface SettingChange {
  key: string;
  before: unknown;
  after: unknown;
}

/** A value the audit log must never carry in the clear. */
function redact(definition: { writeOnly?: boolean }, value: unknown): unknown {
  return definition.writeOnly ? '[redacted]' : value;
}

/**
 * Applies a batch of setting changes.
 *
 * Batched rather than one key at a time because the screen saves a section:
 * working-hours start and end are a pair, and writing one without the other
 * can leave a window that ends before it begins for as long as it takes the
 * second request to land.
 *
 * @throws {AppError} `VALIDATION_ERROR` naming every key that failed, so the
 *         form can mark all of them at once rather than one per round trip.
 */
export async function updateSettings(
  input: Record<string, unknown>,
  actor: SettingsActor,
  ctx: UpdateSettingsContext,
): Promise<SettingChange[]> {
  const entries = Object.entries(input);

  if (entries.length === 0) {
    throw validationError('Nothing to change.', { reason: 'EMPTY' });
  }

  const fields: Record<string, string[]> = {};
  const parsed: Array<{ key: string; value: unknown; writeOnly: boolean }> = [];

  for (const [key, raw] of entries) {
    const definition = settingDefinition(key);

    if (!definition) {
      // An unknown key is a bug or a probe, never a typo worth accepting: the
      // table would silently grow a row nothing reads.
      fields[key] = ['There is no such setting.'];
      continue;
    }

    // A write-only key left blank means "keep what is there", not "clear it".
    if (definition.writeOnly && (raw === '' || raw === undefined || raw === null)) continue;

    const result = definition.schema.safeParse(raw);

    if (!result.success) {
      fields[key] = result.error.issues.map((issue) => issue.message);
      continue;
    }

    parsed.push({ key, value: result.data, writeOnly: definition.writeOnly ?? false });
  }

  if (Object.keys(fields).length > 0) {
    throw validationError('Some settings could not be saved.', { fields });
  }

  if (parsed.length === 0) return [];

  const current = await loadSettings();

  const changes = parsed
    .map((entry): SettingChange => ({
      key: entry.key,
      before: current.get(entry.key),
      after: entry.value,
    }))
    // A no-op write would put a meaningless row in an append-only audit log.
    .filter((change, index) =>
      parsed[index].writeOnly
        ? true
        : JSON.stringify(change.before) !== JSON.stringify(change.after),
    );

  if (changes.length === 0) return [];

  await prisma.$transaction(async (tx) => {
    for (const change of changes) {
      await tx.setting.upsert({
        where: { key: change.key },
        create: { key: change.key, value: change.after as Prisma.InputJsonValue },
        update: { value: change.after as Prisma.InputJsonValue },
      });
    }

    const definitions = changes.map((change) => settingDefinition(change.key)!);

    await writeAudit(tx, {
      actorId: actor.id,
      action: 'SETTINGS_UPDATED',
      entityType: 'SETTING',
      // One row for the batch: the change was one decision by one person, and
      // splitting it loses which values were set together.
      entityId: changes.map((change) => change.key).join(','),
      before: Object.fromEntries(
        changes.map((change, i) => [change.key, redact(definitions[i], change.before)]),
      ) as Prisma.InputJsonValue,
      after: Object.fromEntries(
        changes.map((change, i) => [change.key, redact(definitions[i], change.after)]),
      ) as Prisma.InputJsonValue,
      ipAddress: ctx.ipAddress,
    });
  });

  invalidateSettings();

  log.info({ keys: changes.map((change) => change.key), actorId: actor.id }, 'settings updated');

  // Redacted on the way out too, so a write-only value cannot be read back by
  // writing it and looking at the response.
  return changes.map((change) => {
    const definition = settingDefinition(change.key)!;
    return {
      ...change,
      before: redact(definition, change.before),
      after: redact(definition, change.after),
    };
  });
}
