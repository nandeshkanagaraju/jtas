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
    <div className="flex flex-wrap gap-2">
      <div className="relative min-w-56 flex-1">
        <Search className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
        <Input
          value={filters.search}
          onChange={(event) => onChange({ search: event.target.value })}
          placeholder="Search name, email or phone"
          className="pl-9"
          aria-label="Search users"
        />
      </div>

      <Select
        value={filters.role}
        onValueChange={(value) => onChange({ role: value as RoleValue })}
      >
        <SelectTrigger className="w-44" aria-label="Filter by role">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All roles</SelectItem>
          {(Object.keys(ROLE_LABELS) as RoleValue[]).map((role) => (
            <SelectItem key={role} value={role}>
              {ROLE_LABELS[role]}
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

      <Select
        value={filters.status}
        onValueChange={(value) => onChange({ status: value as StatusFilter })}
      >
        <SelectTrigger className="w-36" aria-label="Filter by status">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="active">Active</SelectItem>
          <SelectItem value="inactive">Deactivated</SelectItem>
          <SelectItem value="all">All</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
