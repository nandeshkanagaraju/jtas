'use client';

import { FilterSelect, SearchField } from '@/components/shared/toolbar';
import type { DepartmentSummary } from '@/lib/services/department-service';
import type { RoleValue } from '@/lib/validation/user';

import { ROLE_LABELS } from './user-badges';

/** Sentinel for the Select, which cannot hold an empty string as a value. */
export const ALL = '__all__';

export type StatusFilter = 'active' | 'inactive' | 'all';

export interface UserFilters {
  search: string;
  role: RoleValue | typeof ALL;
  departmentId: string;
  status: StatusFilter;
}

export function UsersFilters({
  filters,
  onChange,
  departments,
}: {
  filters: UserFilters;
  onChange: (next: Partial<UserFilters>) => void;
  departments: DepartmentSummary[];
}) {
  return (
    <>
      <SearchField
        value={filters.search}
        onChange={(search) => onChange({ search })}
        placeholder="Search name, email or phone"
        label="Search users"
      />

      <FilterSelect
        value={filters.role}
        onChange={(value) => onChange({ role: value as RoleValue })}
        options={(Object.keys(ROLE_LABELS) as RoleValue[]).map((role) => ({
          value: role,
          label: ROLE_LABELS[role],
        }))}
        allValue={ALL}
        allLabel="All roles"
        label="Filter by role"
      />

      <FilterSelect
        value={filters.departmentId}
        onChange={(departmentId) => onChange({ departmentId })}
        options={departments.map((department) => ({
          value: department.id,
          label: department.name,
        }))}
        allValue={ALL}
        allLabel="All departments"
        label="Filter by department"
      />

      <FilterSelect
        value={filters.status}
        onChange={(value) => onChange({ status: value as StatusFilter })}
        options={[
          { value: 'inactive', label: 'Deactivated' },
          { value: 'all', label: 'Everyone' },
        ]}
        allValue="active"
        allLabel="Active"
        label="Filter by status"
      />
    </>
  );
}
