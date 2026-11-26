/**
 * Planning tells Accounts a job is ready to invoice.
 *
 * Accounts works without a deadline (see department-rules): it invoices when
 * Planning intimates. The intimation is stamped on the job, shown in the job
 * register and on the billing page, and mailed to Accounts in the same
 * transaction. Planning may send it again (a second dispatch, a correction);
 * each send is its own mail and its own audit row.
 */
import { z } from 'zod';

import { ACCOUNTS_DEPARTMENT_CODE, PLANNING_DEPARTMENT_CODE } from '@/lib/domain/department-rules';
import { prisma } from '@/lib/db/prisma';
import { conflict, forbidden, notFound } from '@/lib/errors';
import { intimationBody } from '@/lib/notifications/payloads';
import { writeAudit } from '@/lib/services/audit-service';
import { notifyDepartments } from '@/lib/services/notification-service';

export const intimateAccountsSchema = z.object({
  note: z
    .string()
    .trim()
    .max(500, 'Use at most 500 characters.')
    .optional()
    .transform((value) => (value ? value : undefined)),
});

export type IntimateAccountsInput = z.infer<typeof intimateAccountsSchema>;

interface Subject {
  id: string;
  name: string;
  role: string;
  departmentId: string | null;
  managesJobs?: boolean;
}

async function departmentCode(departmentId: string | null): Promise<string | null> {
  if (!departmentId) return null;
  const row = await prisma.department.findUnique({
    where: { id: departmentId },
    select: { code: true },
  });
  return row?.code ?? null;
}

/** Planning, the MD, the Deputy and job managers send the intimation. */
export async function canIntimateAccounts(user: Subject): Promise<boolean> {
  if (user.role === 'MD' || user.role === 'DEPUTY_MD' || user.managesJobs) return true;
  if (user.role !== 'MEMBER') return false;
  return (await departmentCode(user.departmentId)) === PLANNING_DEPARTMENT_CODE;
}

/** Accounts sees whether Planning has sent it. */
export async function seesAccountsIntimation(user: Subject): Promise<boolean> {
  if (await canIntimateAccounts(user)) return true;
  return (await departmentCode(user.departmentId)) === ACCOUNTS_DEPARTMENT_CODE;
}

/**
 * @throws {AppError} `FORBIDDEN`, `NOT_FOUND`, `CONFLICT` for a cancelled or draft job.
 */
export async function intimateAccounts(
  jobId: string,
  input: IntimateAccountsInput,
  actor: Subject,
  ctx: { ipAddress?: string | null },
): Promise<{ at: Date; by: string; note: string | null }> {
  if (!(await canIntimateAccounts(actor))) {
    throw forbidden('Only Planning sends the invoice intimation to Accounts.');
  }

  const job = await prisma.job.findFirst({
    where: { id: jobId, deletedAt: null },
    select: { id: true, status: true, jobCode: true, quantity: true, isDemo: true },
  });
  if (!job) throw notFound('Job');
  if (job.status === 'CANCELLED' || job.status === 'DRAFT') {
    throw conflict('A cancelled or draft job is not invoiced.');
  }

  const senderDepartment =
    actor.role === 'MD' ? 'MD' : actor.role === 'DEPUTY_MD' ? 'Deputy MD' : null;
  const fromLabel = `${actor.name} (${
    senderDepartment ??
    (actor.departmentId
      ? ((
          await prisma.department.findUnique({
            where: { id: actor.departmentId },
            select: { name: true },
          })
        )?.name ?? 'Planning')
      : 'Planning')
  })`;

  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.job.update({
      where: { id: jobId },
      data: {
        accountsIntimatedAt: now,
        accountsIntimatedById: actor.id,
        accountsIntimationNote: input.note ?? null,
      },
    });

    await writeAudit(tx, {
      actorId: actor.id,
      action: 'ACCOUNTS_INTIMATED',
      entityType: 'JOB',
      entityId: jobId,
      after: { note: input.note ?? null, at: now.toISOString() },
      ipAddress: ctx.ipAddress ?? null,
    });

    if (!job.isDemo) {
      await notifyDepartments(tx, {
        jobId,
        departmentCodes: [ACCOUNTS_DEPARTMENT_CODE],
        senderId: actor.id,
        subject: 'Ready to invoice',
        body: intimationBody(fromLabel, [
          ['Job quantity', job.quantity === null ? null : String(job.quantity)],
          ['Note', input.note ?? null],
          ['What to do', 'Raise the invoice on the job page (Billing).'],
        ]),
        dedupeBase: `job:${jobId}:accounts:${now.getTime()}`,
      });
    }
  });

  return { at: now, by: actor.name, note: input.note ?? null };
}
