/**
 * `pnpm suppress-escalation` — stops the sweeper chasing specific subtasks,
 * on the record.
 *
 * Why this exists rather than an UPDATE somebody runs once:
 *
 * The development database carries genuinely overdue work left over from
 * earlier milestones. It is real — real jobs, real assignees, a real audit
 * trail — so it cannot be deleted, and it is overdue, so every sweep chases
 * it. That is free against Mailpit and becomes a burst of real mail the moment
 * the provider is a relay. Testing one notification should not mean sending
 * fourteen.
 *
 * The mechanism is the escalation ceiling the engine already respects:
 * `escalationCount >= escalation.max_count` and the sweeper stops selecting the
 * row (see `escalateOverdue`). Nothing else is touched — not the status, not
 * the deadline, not the job. The subtask stays overdue, stays visible on every
 * dashboard, and still counts against on-time delivery. Only the chasing stops.
 *
 * Every change writes an audit row, because six weeks from now the reasonable
 * question is "why did nobody get chased about JGE-2026-0025", and the answer
 * has to be in the system rather than in somebody's memory of a Monday
 * afternoon. `--restore` puts the counters back from those same rows.
 *
 * Local-only, on the same rule as `pnpm db:reset`.
 */
import { PrismaClient } from '@prisma/client';

import {
  assertLocalDisposableDatabase,
  UnsafeDatabaseError,
  type ParsedDatabaseUrl,
} from './lib/database-url';

const prisma = new PrismaClient();

/** The action written to the audit log. Searchable, and says why. */
export const SUPPRESS_ACTION = 'ESCALATION_SUPPRESSED_FOR_TESTING';
export const RESTORE_ACTION = 'ESCALATION_SUPPRESSION_REVERSED';

/** Mirrors `loadEscalationConfig`'s default; read from settings when present. */
const DEFAULT_MAX_COUNT = 3;

interface Options {
  ids: string[];
  /** Select every currently-chaseable overdue subtask on a non-demo job. */
  allOverdue: boolean;
  /** Subtask ids to leave alone even when they match the filter. */
  except: string[];
  reason: string;
  restore: boolean;
  dryRun: boolean;
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    ids: [],
    allOverdue: false,
    except: [],
    reason: '',
    restore: false,
    dryRun: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === '--all-overdue') options.allOverdue = true;
    else if (arg === '--restore') options.restore = true;
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--reason') options.reason = argv[++i] ?? '';
    else if (arg === '--except') options.except.push(...(argv[++i] ?? '').split(','));
    else if (arg.startsWith('--')) throw new Error(`Unknown flag "${arg}".`);
    else options.ids.push(arg);
  }

  return options;
}

function usage(): void {
  console.error(
    `\nUsage:\n` +
      `  pnpm suppress-escalation <subtaskId...> --reason "..."\n` +
      `  pnpm suppress-escalation --all-overdue --reason "..." [--except id1,id2]\n` +
      `  pnpm suppress-escalation --all-overdue --dry-run\n` +
      `  pnpm suppress-escalation --restore [<subtaskId...> | --all-overdue]\n\n` +
      `A reason is required when suppressing: the audit row is the whole point.\n`,
  );
}

async function maxCount(): Promise<number> {
  const setting = await prisma.setting.findUnique({ where: { key: 'escalation.max_count' } });
  const value = typeof setting?.value === 'number' ? setting.value : DEFAULT_MAX_COUNT;
  return value;
}

/** The subtasks the sweeper would currently chase. Mirrors `escalateOverdue`. */
async function chaseableOverdue(ceiling: number) {
  return prisma.subtask.findMany({
    where: {
      deadline: { lt: new Date() },
      status: { in: ['PENDING', 'IN_PROGRESS', 'BLOCKED', 'AWAITING_APPROVAL'] },
      job: {
        status: { notIn: ['ON_HOLD', 'CANCELLED', 'DRAFT', 'COMPLETED'] },
        isDemo: false,
      },
      escalationCount: { lt: ceiling },
    },
    select: {
      id: true,
      title: true,
      deadline: true,
      escalationCount: true,
      assignee: { select: { email: true } },
      department: { select: { code: true } },
      job: { select: { jobCode: true } },
    },
    orderBy: { deadline: 'asc' },
  });
}

async function suppress(options: Options, ceiling: number): Promise<void> {
  const except = new Set(options.except.filter(Boolean));

  const targets = options.allOverdue
    ? (await chaseableOverdue(ceiling)).filter((row) => !except.has(row.id))
    : await prisma.subtask.findMany({
        where: { id: { in: options.ids } },
        select: {
          id: true,
          title: true,
          deadline: true,
          escalationCount: true,
          assignee: { select: { email: true } },
          department: { select: { code: true } },
          job: { select: { jobCode: true } },
        },
      });

  if (targets.length === 0) {
    console.log('\nNothing matched. No changes made.\n');
    return;
  }

  console.log(
    `\n${options.dryRun ? 'Would suppress' : 'Suppressing'} ${targets.length} subtask(s):\n`,
  );
  for (const row of targets) {
    console.log(
      `  ${row.job.jobCode}  ${row.department.code.padEnd(11)} ${row.assignee.email.padEnd(30)} ` +
        `esc ${row.escalationCount} -> ${ceiling}  ${row.title}`,
    );
  }

  if (options.dryRun) {
    console.log('\n--dry-run: nothing was written.\n');
    return;
  }

  for (const row of targets) {
    /*
     * One transaction per subtask, not one for all of them. A partial run is
     * recoverable — the rows that went through are audited and the rest are
     * untouched — whereas a single transaction over hundreds of subtasks holds
     * locks for as long as it takes and rolls the lot back on one bad row.
     */
    await prisma.$transaction(async (tx) => {
      await tx.subtask.update({
        where: { id: row.id },
        data: { escalationCount: ceiling },
      });

      await tx.auditLog.create({
        data: {
          // No actor: this is an operator action from a script, not a user.
          actorId: null,
          action: SUPPRESS_ACTION,
          entityType: 'SUBTASK',
          entityId: row.id,
          before: { escalationCount: row.escalationCount },
          after: {
            escalationCount: ceiling,
            reason: options.reason,
            jobCode: row.job.jobCode,
            assignee: row.assignee.email,
            note:
              'The escalation counter was raised to its ceiling so the sweeper ' +
              'stops chasing this subtask. Status, deadline and job are unchanged; ' +
              'the work is still overdue and still counts against on-time delivery. ' +
              'Reverse with: pnpm suppress-escalation --restore ' +
              row.id,
          },
          ipAddress: null,
        },
      });
    });
  }

  console.log(`\n  ✔ ${targets.length} suppressed, ${targets.length} audit rows written.`);
  console.log(
    `  Reverse with:  pnpm suppress-escalation --restore ${targets.map((r) => r.id).join(' ')}\n`,
  );
}

/**
 * Puts the counters back, reading the original values out of the audit log.
 *
 * The audit row is the source of truth for what the counter was, which is the
 * reason suppression writes one per subtask rather than one for the batch.
 */
async function restore(options: Options, ceiling: number): Promise<void> {
  const ids = options.allOverdue
    ? (
        await prisma.auditLog.findMany({
          where: { action: SUPPRESS_ACTION },
          select: { entityId: true },
          distinct: ['entityId'],
        })
      ).map((row) => row.entityId)
    : options.ids;

  if (ids.length === 0) {
    console.log('\nNothing to restore.\n');
    return;
  }

  let restored = 0;

  for (const id of ids) {
    const audit = await prisma.auditLog.findFirst({
      where: { action: SUPPRESS_ACTION, entityId: id },
      orderBy: { createdAt: 'desc' },
    });

    if (!audit) {
      console.log(`  ?  ${id} was never suppressed by this script; skipped.`);
      continue;
    }

    const before = audit.before as { escalationCount?: number } | null;
    const previous = typeof before?.escalationCount === 'number' ? before.escalationCount : 0;

    await prisma.$transaction(async (tx) => {
      await tx.subtask.update({ where: { id }, data: { escalationCount: previous } });
      await tx.auditLog.create({
        data: {
          actorId: null,
          action: RESTORE_ACTION,
          entityType: 'SUBTASK',
          entityId: id,
          before: { escalationCount: ceiling },
          after: { escalationCount: previous, restoredFromAuditId: audit.id },
          ipAddress: null,
        },
      });
    });

    restored++;
  }

  console.log(`\n  ✔ ${restored} subtask(s) restored; the sweeper will chase them again.\n`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (!options.restore && !options.allOverdue && options.ids.length === 0) {
    usage();
    process.exit(1);
  }

  if (!options.restore && !options.dryRun && options.reason.trim() === '') {
    console.error('\n  ✖ --reason is required. The audit row is the point of this script.\n');
    process.exit(1);
  }

  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set. Copy .env.example to .env.');
    process.exit(1);
  }

  let parsed: ParsedDatabaseUrl;
  try {
    parsed = assertLocalDisposableDatabase(url);
  } catch (error) {
    if (error instanceof UnsafeDatabaseError) {
      console.error(`\n  ✖ ${error.message}\n`);
      process.exit(1);
    }
    throw error;
  }

  console.log(`\nTarget: ${parsed.host}:${parsed.port}/${parsed.database}`);

  const ceiling = await maxCount();

  if (options.restore) await restore(options, ceiling);
  else await suppress(options, ceiling);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
