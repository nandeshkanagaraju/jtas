'use client';

import { Search } from 'lucide-react';

import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { DepartmentSummary } from '@/lib/services/department-service';
import type { JobStatusValue, PriorityValue } from '@/lib/validation/job';

export const ALL = '__all__';

export interface JobFilters {
  search: string;
  status: JobStatusValue | typeof ALL;
  priority: PriorityValue | typeof ALL;
  departmentId: string;
}

const STATUS_OPTIONS: Array<{ value: JobStatusValue; label: string }> = [
  { value: 'DRAFT', label: 'Draft' },
  { value: 'IN_PROGRESS', label: 'In progress' },
  { value: 'AT_RISK', label: 'At risk' },
  { value: 'DELAYED', label: 'Delayed' },
  { value: 'ON_HOLD', label: 'On hold' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'CANCELLED', label: 'Cancelled' },
];

const PRIORITY_OPTIONS: Array<{ value: PriorityValue; label: string }> = [
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
    <div className="flex flex-wrap gap-2">
      <div className="relative min-w-56 flex-1">
        <Search className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
        <Input
          value={filters.search}
          onChange={(event) => onChange({ search: event.target.value })}
          placeholder="Search job code, title, part number or customer"
          className="pl-9"
          aria-label="Search jobs"
        />
      </div>

      <Select
        value={filters.status}
        onValueChange={(value) => onChange({ status: value as JobStatusValue })}
      >
        <SelectTrigger className="w-40" aria-label="Filter by status">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All statuses</SelectItem>
          {STATUS_OPTIONS.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={filters.priority}
        onValueChange={(value) => onChange({ priority: value as PriorityValue })}
      >
        <SelectTrigger className="w-36" aria-label="Filter by priority">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All priorities</SelectItem>
          {PRIORITY_OPTIONS.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={filters.departmentId}
        onValueChange={(value) => onChange({ departmentId: value })}
      >
        <SelectTrigger className="w-44" aria-label="Filter by department">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All departments</SelectItem>
          {departments.map((department) => (
            <SelectItem key={department.id} value={department.id}>
              {department.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
