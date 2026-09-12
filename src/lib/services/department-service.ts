/**
 * Departments (SDD section 6.2 — `GET /api/departments`).
 *
 * The eight functions a CNC job passes through. They are reference data seeded
 * once and never created through the UI, so this service is read-only;
 * maintaining them is a migration, not a feature.
 */
import { prisma } from '@/lib/db/prisma';

export interface DepartmentSummary {
  id: string;
  code: string;
  name: string;
  sequenceOrder: number;
  isActive: boolean;
  /** Active users in the department, so the directory can show staffing. */
  memberCount: number;
}

/**
 * Lists departments in shop-flow order (PDD section 6.1), which is the order
 * every screen shows them in — it is layout as much as data.
 */
export async function listDepartments(
  options: { includeInactive?: boolean } = {},
): Promise<DepartmentSummary[]> {
  const departments = await prisma.department.findMany({
    where: options.includeInactive ? {} : { isActive: true },
    orderBy: { sequenceOrder: 'asc' },
    select: {
      id: true,
      code: true,
      name: true,
      sequenceOrder: true,
      isActive: true,
      _count: { select: { users: { where: { isActive: true } } } },
    },
  });

  return departments.map((department) => ({
    id: department.id,
    code: department.code,
    name: department.name,
    sequenceOrder: department.sequenceOrder,
    isActive: department.isActive,
    memberCount: department._count.users,
  }));
}
