'use client';

import { FilterSelect, SearchField } from '@/components/shared/toolbar';
import type { DepartmentSummary } from '@/lib/services/department-service';
import type { JobStatusValue, PriorityValue } from '@/lib/validation/job';

export const ALL = '__all__';

export interface JobFilters {
  search: string;
  status: JobStatusValue | typeof ALL;
  priority: PriorityValue | typeof ALL;
  departmentId: string;
}

export const STATUS_OPTIONS: Array<{ value: JobStatusValue; label: string }> = [
  { value: 'DRAFT', label: 'Draft' },
  { value: 'IN_PROGRESS', label: 'In progress' },
  { value: 'AT_RISK', label: 'At risk' },
  { value: 'DELAYED', label: 'Delayed' },
  { value: 'ON_HOLD', label: 'On hold' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'CANCELLED', label: 'Cancelled' },
];

export const PRIORITY_OPTIONS: Array<{ value: PriorityValue; label: string }> = [
  { value: 'URGENT', label: 'Urgent' },
  { value: 'HIGH', label: 'High' },
  { value: 'NORMAL', label: 'Normal' },
  { value: 'LOW', label: 'Low' },
];

export function JobsFilters({
  filters,
  onChange,
  departments,
}: {
  filters: JobFilters;
  onChange: (next: Partial<JobFilters>) => void;
  departments: DepartmentSummary[];
}) {
  return (
    <>
      <SearchField
        value={filters.search}
        onChange={(search) => onChange({ search })}
        placeholder="Search job code, title, part number or customer"
        label="Search jobs"
      />

      <FilterSelect
        value={filters.status}
        onChange={(value) => onChange({ status: value as JobStatusValue })}
        options={STATUS_OPTIONS}
        allValue={ALL}
        allLabel="All statuses"
        label="Filter by status"
      />

      <FilterSelect
        value={filters.priority}
        onChange={(value) => onChange({ priority: value as PriorityValue })}
        options={PRIORITY_OPTIONS}
        allValue={ALL}
        allLabel="All priorities"
        label="Filter by priority"
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
    </>
  );
}
