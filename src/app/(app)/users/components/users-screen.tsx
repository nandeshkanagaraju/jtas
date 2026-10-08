'use client';

import type { Role } from '@prisma/client';
import { UserPlus } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { PageHeader } from '@/components/shared/page-header';
import { ErrorState } from '@/components/shared/states';
import { Toolbar } from '@/components/shared/toolbar';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api/client';
import {
  createUserRequest,
  deactivateUserRequest,
  fetchUsers,
  reactivateUserRequest,
  resetPasswordRequest,
  updateUserRequest,
  type UserRow,
} from '@/lib/api/users-client';
import type { DepartmentSummary } from '@/lib/services/department-service';
import type { CreateUserInput } from '@/lib/validation/user';

import { DeactivateDialog } from './deactivate-dialog';
import { TemporaryPasswordDialog } from './temporary-password-dialog';
import { UserFormDialog } from './user-form-dialog';
import { ALL, UsersFilters, type UserFilters } from './users-filters';
import { UsersTable } from './users-table';

interface SecretState {
  user: UserRow;
  password: string;
  context: 'created' | 'reset';
}

const INITIAL_FILTERS: UserFilters = {
  search: '',
  role: ALL,
  departmentId: ALL,
  status: 'active',
};

/**
 * Orchestrates the directory: filter state, data loading, and which dialog is
 * open. The presentation lives in `users-filters` and `users-table`, and every
 * rule it appears to enforce is enforced again on the server.
 */
export function UsersScreen({
  departments,
  currentUser,
}: {
  departments: DepartmentSummary[];
  currentUser: { id: string; role: Role };
}) {
  const [rows, setRows] = useState<UserRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [filters, setFilters] = useState<UserFilters>(INITIAL_FILTERS);
  const [debouncedSearch, setDebouncedSearch] = useState('');

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<UserRow | null>(null);
  const [secret, setSecret] = useState<SecretState | null>(null);
  const [deactivating, setDeactivating] = useState<UserRow | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Typing should not fire a request per keystroke on a 4G connection; 300 ms
  // is below the point where it starts to feel laggy.
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(filters.search), 300);
    return () => window.clearTimeout(timer);
  }, [filters.search]);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);

    try {
      const result = await fetchUsers({
        q: debouncedSearch || undefined,
        role: filters.role === ALL ? undefined : filters.role,
        departmentId: filters.departmentId === ALL ? undefined : filters.departmentId,
        status: filters.status,
        pageSize: 100,
      });
      setRows(result.data);
      setTotal(result.total);
    } catch (error) {
      setLoadError(
        error instanceof ApiError ? error.message : 'Could not load the user directory.',
      );
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, filters.role, filters.departmentId, filters.status]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Who may take over a leaver's subtasks. Mirrors the server rule so the list
   * offers only choices that will be accepted — the server still enforces it.
   */
  const reassignmentCandidates = useMemo(() => {
    if (!deactivating) return [];
    return rows.filter(
      (row) =>
        row.id !== deactivating.id &&
        row.isActive &&
        row.role !== 'ADMIN' &&
        row.departmentId === deactivating.departmentId,
    );
  }, [rows, deactivating]);

  /** Wraps an action so a failure surfaces instead of vanishing. */
  async function run(user: UserRow, action: () => Promise<void>, failure: string) {
    setBusyId(user.id);
    try {
      await action();
      await load();
    } catch (error) {
      setLoadError(error instanceof ApiError ? error.message : failure);
    } finally {
      setBusyId(null);
    }
  }

  async function handleSubmitUser(values: CreateUserInput) {
    if (editing) {
      await updateUserRequest(editing.id, values);
      setFormOpen(false);
      await load();
      return;
    }

    const { user, temporaryPassword } = await createUserRequest(values);
    setFormOpen(false);
    setSecret({ user, password: temporaryPassword, context: 'created' });
    await load();
  }

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Accounts and access"
        title="Users"
        lead={`${total} ${total === 1 ? 'account' : 'accounts'}. Accounts are never deleted — a departed colleague stays visible on the jobs they worked on.`}
        actions={
          <Button
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
          >
            <UserPlus className="size-4" />
            Add user
          </Button>
        }
      >
        <Toolbar label="Filter users">
          <UsersFilters
            filters={filters}
            departments={departments}
            onChange={(next) => setFilters((current) => ({ ...current, ...next }))}
          />
        </Toolbar>
      </PageHeader>

      {loadError ? <ErrorState message={loadError} onRetry={() => void load()} /> : null}

      <UsersTable
        rows={rows}
        loading={loading}
        currentUserId={currentUser.id}
        busyId={busyId}
        onEdit={(user) => {
          setEditing(user);
          setFormOpen(true);
        }}
        onDeactivate={setDeactivating}
        onResetPassword={(user) =>
          run(
            user,
            async () => {
              const result = await resetPasswordRequest(user.id);
              setSecret({
                user: result.user,
                password: result.temporaryPassword,
                context: 'reset',
              });
            },
            'Could not reset the password.',
          )
        }
        onReactivate={(user) =>
          run(
            user,
            () => reactivateUserRequest(user.id).then(() => undefined),
            'Could not reactivate.',
          )
        }
      />

      <UserFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        departments={departments}
        editing={editing}
        onSubmit={handleSubmitUser}
      />

      <DeactivateDialog
        open={deactivating !== null}
        onOpenChange={(open) => !open && setDeactivating(null)}
        user={deactivating}
        candidates={reassignmentCandidates}
        onConfirm={async (body) => {
          await deactivateUserRequest(deactivating!.id, body);
          setDeactivating(null);
          await load();
        }}
      />

      {secret ? (
        <TemporaryPasswordDialog
          open
          onOpenChange={(open) => !open && setSecret(null)}
          userName={secret.user.name}
          userEmail={secret.user.email}
          password={secret.password}
          context={secret.context}
        />
      ) : null}
    </div>
  );
}
