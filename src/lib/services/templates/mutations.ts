/**
 * Job template management (build spec M9.5).
 *
 * Editing a template never touches a job. A template is a recipe, and the jobs
 * already created from it are meals — changing the recipe cannot reach back
 * into a chain that a department is already working to. The screen says so, and
 * this file is why it is true: nothing here reads or writes `Subtask`.
 *
 * Templates are not hard-deleted (architecture rule 6 and improvement I-12).
 * `isActive: false` hides one from the create-job picker while leaving the
 * record that explains how an old job was laid out.
 */
import type { Prisma } from '@prisma/client';

import { prisma } from '@/lib/db/prisma';
import { conflict, notFound, validationError } from '@/lib/errors';
import { writeAudit } from '@/lib/services/audit-service';

import type { TemplateSummary } from '../job-template-service';
import { getJobTemplate } from '../job-template-service';

export interface TemplateActor {
  id: string;
}

export interface TemplateContext {
  ipAddress: string | null;
}

export interface TemplateItemInput {
  departmentId: string;
  title: string;
  /** Hours before the job's overall deadline this step is due. */
  offsetHoursBeforeDue: number;
  reminderLeadMinutes: number;
  /** The `order` of the item this one waits for, or null. */
  dependsOnItemOrder: number | null;
}

export interface TemplateInput {
  name: string;
  items: TemplateItemInput[];
}

/**
 * Checks a template's shape before it is stored.
 *
 * The dependency rules are the ones that matter. A cycle would deadlock every
 * job created from the template — every subtask BLOCKED, waiting on another
 * that is waiting on it — and it is far cheaper to refuse the template than to
 * unpick forty jobs later.
 */
export function validateTemplate(input: TemplateInput): void {
  const fields: Record<string, string[]> = {};

  if (input.name.trim().length < 3) {
    fields.name = ['Give the template a name of at least 3 characters.'];
  }

  if (input.items.length === 0) {
    fields.items = ['A template needs at least one step.'];
  }

  if (input.items.length > 30) {
    fields.items = ['At most 30 steps — beyond that it is a process, not a job.'];
  }

  input.items.forEach((item, index) => {
    const at = `items.${index}`;

    if (item.title.trim().length < 3) {
      fields[`${at}.title`] = ['Each step needs a title.'];
    }

    if (!Number.isInteger(item.offsetHoursBeforeDue) || item.offsetHoursBeforeDue < 0) {
      fields[`${at}.offsetHoursBeforeDue`] = ['Hours before the deadline, zero or more.'];
    }

    if (item.reminderLeadMinutes < 1 || item.reminderLeadMinutes > 10_080) {
      fields[`${at}.reminderLeadMinutes`] = ['Between 1 minute and a week.'];
    }

    const dependsOn = item.dependsOnItemOrder;

    if (dependsOn !== null) {
      if (dependsOn === index) {
        fields[`${at}.dependsOnItemOrder`] = ['A step cannot wait for itself.'];
      } else if (dependsOn < 0 || dependsOn >= input.items.length) {
        fields[`${at}.dependsOnItemOrder`] = ['That step is not in this template.'];
      } else if (dependsOn > index) {
        /*
         * Forward references are refused rather than sorted out. The offsets
         * run backwards from the deadline, so a step that waits for a later one
         * is asking to finish before the thing it depends on starts — always a
         * mistake, never an intention.
         */
        fields[`${at}.dependsOnItemOrder`] = ['A step can only wait for one earlier in the chain.'];
      }
    }
  });

  if (Object.keys(fields).length > 0) {
    throw validationError('That template cannot be saved.', { fields });
  }

  assertNoCycle(input.items);
}

/** Walks the dependency chain, refusing a loop. */
function assertNoCycle(items: TemplateItemInput[]): void {
  for (let start = 0; start < items.length; start++) {
    const seen = new Set<number>([start]);
    let cursor = items[start].dependsOnItemOrder;

    while (cursor !== null && cursor !== undefined) {
      if (seen.has(cursor)) {
        throw validationError('Those steps wait for each other in a loop.', {
          fields: {
            [`items.${start}.dependsOnItemOrder`]: [
              'Following this dependency comes back to where it started.',
            ],
          },
        });
      }

      seen.add(cursor);
      cursor = items[cursor]?.dependsOnItemOrder ?? null;
    }
  }
}

/** Rows for `createMany`, with `order` assigned from position. */
function toRows(
  templateId: string,
  items: TemplateItemInput[],
): Prisma.JobTemplateItemCreateManyInput[] {
  return items.map((item, index) => ({
    templateId,
    order: index,
    departmentId: item.departmentId,
    title: item.title.trim(),
    offsetHoursBeforeDue: item.offsetHoursBeforeDue,
    reminderLeadMinutes: item.reminderLeadMinutes,
    dependsOnItemOrder: item.dependsOnItemOrder,
  }));
}

export async function createTemplate(
  input: TemplateInput,
  actor: TemplateActor,
  ctx: TemplateContext,
): Promise<TemplateSummary> {
  validateTemplate(input);
  await assertDepartmentsExist(input.items);

  const id = await prisma.$transaction(async (tx) => {
    const template = await tx.jobTemplate.create({
      data: { name: input.name.trim() },
      select: { id: true },
    });

    await tx.jobTemplateItem.createMany({ data: toRows(template.id, input.items) });

    await writeAudit(tx, {
      actorId: actor.id,
      action: 'TEMPLATE_CREATED',
      entityType: 'TEMPLATE',
      entityId: template.id,
      after: { name: input.name.trim(), steps: input.items.length },
      ipAddress: ctx.ipAddress,
    });

    return template.id;
  });

  return getJobTemplate(id);
}

/**
 * Replaces a template's name and steps.
 *
 * The items are deleted and rewritten rather than diffed. An item carries no
 * history of its own — nothing references a `JobTemplateItem` once a job has
 * been created — so a diff would be effort spent to preserve ids nobody holds.
 */
export async function updateTemplate(
  templateId: string,
  input: TemplateInput,
  actor: TemplateActor,
  ctx: TemplateContext,
): Promise<TemplateSummary> {
  validateTemplate(input);
  await assertDepartmentsExist(input.items);

  const before = await prisma.jobTemplate.findUnique({
    where: { id: templateId },
    select: { id: true, name: true, isActive: true, _count: { select: { items: true } } },
  });

  if (!before) throw notFound('Job template');
  if (!before.isActive) {
    throw conflict('That template is archived. Restore it before editing.', {
      reason: 'TEMPLATE_ARCHIVED',
    });
  }

  await prisma.$transaction(async (tx) => {
    await tx.jobTemplateItem.deleteMany({ where: { templateId } });
    await tx.jobTemplateItem.createMany({ data: toRows(templateId, input.items) });
    await tx.jobTemplate.update({ where: { id: templateId }, data: { name: input.name.trim() } });

    await writeAudit(tx, {
      actorId: actor.id,
      action: 'TEMPLATE_UPDATED',
      entityType: 'TEMPLATE',
      entityId: templateId,
      before: { name: before.name, steps: before._count.items },
      after: { name: input.name.trim(), steps: input.items.length },
      ipAddress: ctx.ipAddress,
    });
  });

  return getJobTemplate(templateId);
}

/** Hides a template from the picker without losing it. */
export async function setTemplateActive(
  templateId: string,
  isActive: boolean,
  actor: TemplateActor,
  ctx: TemplateContext,
): Promise<void> {
  const before = await prisma.jobTemplate.findUnique({
    where: { id: templateId },
    select: { name: true, isActive: true },
  });

  if (!before) throw notFound('Job template');
  if (before.isActive === isActive) return;

  await prisma.$transaction(async (tx) => {
    await tx.jobTemplate.update({ where: { id: templateId }, data: { isActive } });

    await writeAudit(tx, {
      actorId: actor.id,
      action: 'TEMPLATE_ARCHIVED',
      entityType: 'TEMPLATE',
      entityId: templateId,
      before: { name: before.name, isActive: before.isActive },
      after: { name: before.name, isActive },
      ipAddress: ctx.ipAddress,
    });
  });
}

/** Refuses a step pointing at a department that does not exist or is inactive. */
async function assertDepartmentsExist(items: TemplateItemInput[]): Promise<void> {
  const ids = [...new Set(items.map((item) => item.departmentId))];

  const found = await prisma.department.findMany({
    where: { id: { in: ids }, isActive: true },
    select: { id: true },
  });

  if (found.length === ids.length) return;

  const known = new Set(found.map((row) => row.id));
  const fields: Record<string, string[]> = {};

  items.forEach((item, index) => {
    if (!known.has(item.departmentId)) {
      fields[`items.${index}.departmentId`] = ['Choose an active department.'];
    }
  });

  throw validationError('A step points at a department that is not available.', { fields });
}
