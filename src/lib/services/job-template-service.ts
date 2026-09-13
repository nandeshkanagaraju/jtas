/**
 * Job templates — FR-11, PDD improvement I-03.
 *
 * "Creating eight subtasks by hand for every order will not survive contact
 * with a busy MD." A template stores the standard chain with offsets measured
 * backwards from the job deadline, so one template serves a rush job and a long
 * one alike — the whole chain compresses or stretches with the due date.
 *
 * Read-only: templates are reference data, seeded and maintained by migration
 * (SDD section 6.2 exposes no write endpoint). Management is FR-74, deferred.
 */
import { prisma } from '@/lib/db/prisma';
import { notFound } from '@/lib/errors';

export interface TemplateItemSummary {
  id: string;
  order: number;
  title: string;
  offsetHoursBeforeDue: number;
  reminderLeadMinutes: number;
  /** References another item's `order` in the same template. */
  dependsOnItemOrder: number | null;
  department: { id: string; name: string; code: string; sequenceOrder: number };
}

export interface TemplateSummary {
  id: string;
  name: string;
  items: TemplateItemSummary[];
}

export async function listJobTemplates(): Promise<TemplateSummary[]> {
  const templates = await prisma.jobTemplate.findMany({
    where: { isActive: true },
    orderBy: { name: 'asc' },
    select: { id: true, name: true },
  });

  if (templates.length === 0) return [];

  const items = await prisma.jobTemplateItem.findMany({
    where: { templateId: { in: templates.map((t) => t.id) } },
    orderBy: { order: 'asc' },
    select: {
      id: true,
      templateId: true,
      order: true,
      title: true,
      offsetHoursBeforeDue: true,
      reminderLeadMinutes: true,
      dependsOnItemOrder: true,
      departmentId: true,
    },
  });

  // `JobTemplateItem.departmentId` has no relation declared on the model, so
  // the department is resolved here rather than through an include.
  const departments = await prisma.department.findMany({
    where: { id: { in: [...new Set(items.map((item) => item.departmentId))] } },
    select: { id: true, name: true, code: true, sequenceOrder: true },
  });
  const departmentById = new Map(departments.map((d) => [d.id, d]));

  return templates.map((template) => ({
    id: template.id,
    name: template.name,
    items: items
      .filter((item) => item.templateId === template.id)
      .flatMap((item) => {
        const department = departmentById.get(item.departmentId);
        // A template referencing a department that no longer exists is a seed
        // problem; skip the row rather than breaking the whole wizard.
        if (!department) return [];

        return [
          {
            id: item.id,
            order: item.order,
            title: item.title,
            offsetHoursBeforeDue: item.offsetHoursBeforeDue,
            reminderLeadMinutes: item.reminderLeadMinutes,
            dependsOnItemOrder: item.dependsOnItemOrder,
            department,
          },
        ];
      }),
  }));
}

/** @throws {AppError} `NOT_FOUND` */
export async function getJobTemplate(templateId: string): Promise<TemplateSummary> {
  const template = (await listJobTemplates()).find((t) => t.id === templateId);
  if (!template) throw notFound('Template');
  return template;
}
