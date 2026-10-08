'use client';

import { KeyRound, Pencil, Undo2, Users, UserX } from 'lucide-react';

import { Panel } from '@/components/shared/panel';
import { EmptyState, TableSkeleton } from '@/components/shared/states';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { UserRow } from '@/lib/api/users-client';
import { formatIST } from '@/lib/utils/time';

import { ROLE_LABELS, RoleBadge, StatusBadge } from './user-badges';

/**
 * The directory table.
 *
 * Columns drop away as the viewport narrows — role, department and last login
 * are folded into the name cell on a phone, and the name is truncated there so
 * the three action buttons stay on screen rather than behind a horizontal
 * scroll nobody discovers.
 */
export function UsersTable({
  rows,
  loading,
  currentUserId,
  busyId,
  onEdit,
  onResetPassword,
  onDeactivate,
  onReactivate,
}: {
  rows: UserRow[];
  loading: boolean;
  currentUserId: string;
  busyId: string | null;
  onEdit: (user: UserRow) => void;
  onResetPassword: (user: UserRow) => void;
  onDeactivate: (user: UserRow) => void;
  onReactivate: (user: UserRow) => void;
}) {
  if (loading) {
    return (
      <Panel flush>
        <TableSkeleton rows={6} columns={4} />
      </Panel>
    );
  }

  if (rows.length === 0) {
    return (
      <Panel flush>
        <EmptyState
          icon={Users}
          title="No users match these filters"
          description="Widen the role, department or status filter above."
        />
      </Panel>
    );
  }

  return (
    <Panel flush>
      <Table>
        <TableHeader>
          <TableRow className="border-rule hover:bg-transparent">
            <TableHead className="pl-4">Name</TableHead>
            <TableHead className="hidden sm:table-cell">Role</TableHead>
            <TableHead className="hidden md:table-cell">Department</TableHead>
            <TableHead className="hidden lg:table-cell">Last login</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="pr-4 text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((user) => (
            <TableRow key={user.id} className={user.isActive ? undefined : 'opacity-60'}>
              <TableCell className="py-3 pl-4">
                <div className="max-w-[8.5rem] truncate font-medium sm:max-w-none">{user.name}</div>
                <div className="text-muted-foreground max-w-[8.5rem] truncate text-xs sm:max-w-none">
                  {user.email}
                </div>
                <div className="text-muted-foreground mt-1 max-w-[8.5rem] truncate text-xs sm:hidden">
                  {ROLE_LABELS[user.role]}
                  {user.departmentName ? ` · ${user.departmentName}` : ''}
                </div>
              </TableCell>

              <TableCell className="hidden sm:table-cell">
                <RoleBadge role={user.role} />
              </TableCell>

              <TableCell className="text-muted-foreground hidden md:table-cell">
                {user.departmentName ?? '—'}
              </TableCell>

              <TableCell className="code text-muted-foreground hidden text-sm lg:table-cell">
                {user.lastLoginAt ? formatIST(new Date(user.lastLoginAt)) : 'Never'}
              </TableCell>

              <TableCell>
                <StatusBadge
                  isActive={user.isActive}
                  lockedUntil={user.lockedUntil}
                  mustChangePassword={user.mustChangePassword}
                />
                {user.isActive && (user.openSubtaskCount ?? 0) > 0 ? (
                  <div className="text-muted-foreground mt-1 text-xs">
                    <span className="code">{user.openSubtaskCount}</span> open
                  </div>
                ) : null}
              </TableCell>

              <TableCell className="pr-4 text-right">
                <div className="flex justify-end gap-0.5 sm:gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Edit ${user.name}`}
                    onClick={() => onEdit(user)}
                  >
                    <Pencil className="size-4" />
                  </Button>

                  {user.isActive ? (
                    <>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Reset password for ${user.name}`}
                        disabled={busyId === user.id}
                        onClick={() => onResetPassword(user)}
                      >
                        <KeyRound className="size-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Deactivate ${user.name}`}
                        // Deactivating yourself would lock you out; the
                        // server refuses it too.
                        disabled={user.id === currentUserId}
                        onClick={() => onDeactivate(user)}
                      >
                        <UserX className="size-4" />
                      </Button>
                    </>
                  ) : (
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Reactivate ${user.name}`}
                      disabled={busyId === user.id}
                      onClick={() => onReactivate(user)}
                    >
                      <Undo2 className="size-4" />
                    </Button>
                  )}
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Panel>
  );
}
