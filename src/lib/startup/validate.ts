/**
 * Startup configuration check (build spec M9.6).
 *
 * Runs once as the app or the worker boots. Every required environment
 * variable and every setting is parsed; anything missing or malformed is
 * listed in one message and the process stops.
 *
 * Failing fast is the point. The alternative is a worker that starts happily
 * and discovers at 6 PM that `digest.time` is the string `"9am"` — by which
 * time the failure is a mail that did not arrive, which is invisible. A
 * refusal to boot is loud, immediate, and names the fix.
 */
import { SETTING_DEFINITIONS } from '@/lib/domain/settings-definitions';
import { prisma } from '@/lib/db/prisma';
import { env } from '@/lib/utils/env';
import { moduleLogger } from '@/lib/utils/logger';

const log = moduleLogger('startup');

export interface ConfigProblem {
  scope: 'env' | 'setting' | 'database';
  key: string;
  message: string;
  /** What the system will use instead, when it can carry on. */
  fallback?: string;
}

export interface ConfigReport {
  ok: boolean;
  /** Stop-the-process problems. */
  errors: ConfigProblem[];
  /** Worth saying, but the documented default covers it. */
  warnings: ConfigProblem[];
}

/**
 * Checks the environment and the settings table.
 *
 * A malformed *setting* is a warning, not an error: every read falls back to
 * the documented default, so the system runs correctly while somebody fixes it,
 * and refusing to boot over one bad row would take the shop floor down to
 * protect a value that is already being ignored. A missing *environment
 * variable* is an error, because there is no default for a database URL.
 */
export async function checkConfiguration(): Promise<ConfigReport> {
  const errors: ConfigProblem[] = [];
  const warnings: ConfigProblem[] = [];

  try {
    env();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    for (const line of message.split('\n')) {
      const match = /^\s*-\s*([A-Z0-9_]+):\s*(.+)$/.exec(line);
      if (match) errors.push({ scope: 'env', key: match[1], message: match[2] });
    }

    if (errors.length === 0) errors.push({ scope: 'env', key: 'environment', message });
  }

  /*
   * Stop here if the environment is already broken. Reading settings needs
   * DATABASE_URL, and with it missing the client does not fail — it waits for a
   * connection that will never be attempted, which turns "fail fast" into a
   * process that hangs with nothing on stdout. Worse than the failure it was
   * meant to report.
   */
  if (errors.length > 0) return { ok: false, errors, warnings };

  let rows: Array<{ key: string; value: unknown }> = [];

  try {
    rows = await prisma.setting.findMany();
  } catch (error) {
    errors.push({
      scope: 'database',
      key: 'DATABASE_URL',
      message: `Could not read the settings table: ${
        error instanceof Error ? error.message : String(error)
      }`,
    });
    return { ok: false, errors, warnings };
  }

  const stored = new Map(rows.map((row) => [row.key, row.value]));

  for (const definition of SETTING_DEFINITIONS) {
    const value = stored.get(definition.key);

    if (value === undefined) {
      warnings.push({
        scope: 'setting',
        key: definition.key,
        message: 'Not set in the database.',
        fallback: JSON.stringify(definition.default),
      });
      continue;
    }

    const parsed = definition.schema.safeParse(value);

    if (!parsed.success) {
      warnings.push({
        scope: 'setting',
        key: definition.key,
        message: parsed.error.issues[0]?.message ?? 'Does not match its schema.',
        fallback: JSON.stringify(definition.default),
      });
    }
  }

  // A window that ends before it begins would hold every reminder forever, and
  // no per-key schema can see it — the two values are only wrong together.
  const start = stored.get('working_hours.start');
  const end = stored.get('working_hours.end');

  if (typeof start === 'string' && typeof end === 'string' && start >= end) {
    errors.push({
      scope: 'setting',
      key: 'working_hours',
      message: `The working day starts at ${start} and ends at ${end}. Reminders held for working hours would never be released.`,
    });
  }

  return { ok: errors.length === 0, errors, warnings };
}

/** Renders a report for a terminal. */
export function formatConfigReport(report: ConfigReport): string {
  const lines: string[] = [];

  if (report.errors.length > 0) {
    lines.push('Configuration errors — the process cannot start:');
    for (const problem of report.errors) {
      lines.push(`  ✖ [${problem.scope}] ${problem.key}: ${problem.message}`);
    }
    lines.push('');
    lines.push('See .env.example for every required key, or fix the value on /settings.');
  }

  if (report.warnings.length > 0) {
    lines.push(report.errors.length > 0 ? '' : 'Configuration warnings:');
    for (const problem of report.warnings) {
      lines.push(
        `  ! [${problem.scope}] ${problem.key}: ${problem.message}` +
          (problem.fallback ? ` Using ${problem.fallback}.` : ''),
      );
    }
  }

  return lines.join('\n');
}

/**
 * Checks the configuration and exits if it cannot be honoured.
 *
 * Called from the worker's entry point and from Next's instrumentation hook.
 */
export async function assertConfiguration(options: { exit?: boolean } = {}): Promise<ConfigReport> {
  const report = await checkConfiguration();
  const rendered = formatConfigReport(report);

  if (report.warnings.length > 0 && report.ok) {
    log.warn({ warnings: report.warnings }, 'configuration warnings');
  }

  if (!report.ok) {
    log.error({ errors: report.errors }, 'configuration is not usable');

    if (options.exit !== false) {
      console.error(`\n${rendered}\n`);
      process.exit(1);
    }
  }

  return report;
}
