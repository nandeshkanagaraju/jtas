'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ApiError } from '@/lib/api/client';
import type { UserRow } from '@/lib/api/users-client';
import type { DepartmentSummary } from '@/lib/services/department-service';
import { createUserSchema, type CreateUserInput, type RoleValue } from '@/lib/validation/user';

import { ROLE_LABELS } from './user-badges';

/** Sentinel for the Select, which cannot hold an empty string as a value. */
const NO_DEPARTMENT = '__none__';

const ASSIGNABLE_ROLES: RoleValue[] = ['MEMBER', 'DEPUTY_MD', 'ADMIN', 'MD'];

/**
 * Create and edit share one dialog, because they share one shape. The only
 * difference is that editing does not issue a password, so the caller decides
 * what to do with the result.
 */
export function UserFormDialog({
  open,
  onOpenChange,
  departments,
  editing,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  departments: DepartmentSummary[];
  /** Absent when creating. */
  editing?: UserRow | null;
  onSubmit: (values: CreateUserInput) => Promise<void>;
}) {
  const [formError, setFormError] = useState<string | null>(null);

  const form = useForm<CreateUserInput>({
    resolver: zodResolver(createUserSchema),
    defaultValues: { name: '', email: '', phone: undefined, role: 'MEMBER', departmentId: null },
  });

  // Re-seed whenever the dialog opens, so a previous edit does not leak into
  // the next one.
  useEffect(() => {
    if (!open) return;
    setFormError(null);
    form.reset(
      editing
        ? {
            name: editing.name,
            email: editing.email,
            phone: editing.phone ?? undefined,
            role: editing.role,
            departmentId: editing.departmentId,
          }
        : { name: '', email: '', phone: undefined, role: 'MEMBER', departmentId: null },
    );
  }, [open, editing, form]);

  const role = form.watch('role');
  const needsDepartment = role === 'MEMBER';

  // Clearing the department when the role stops needing one keeps the form
  // consistent with the invariant the server enforces, rather than letting the
  // user submit something that will be rejected.
  useEffect(() => {
    if (!needsDepartment) form.setValue('departmentId', null, { shouldValidate: false });
  }, [needsDepartment, form]);

  async function handleSubmit(values: CreateUserInput) {
    setFormError(null);
    try {
      await onSubmit(values);
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.fields) {
          for (const [field, messages] of Object.entries(error.fields)) {
            if (field in values) {
              form.setError(field as keyof CreateUserInput, { message: messages[0] });
            }
          }
        }
        setFormError(error.message);
      } else {
        setFormError('Could not reach the server. Check your connection and try again.');
      }
    }
  }

  const isSubmitting = form.formState.isSubmitting;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{editing ? 'Edit user' : 'Add user'}</DialogTitle>
          <DialogDescription>
            {editing
              ? 'Changes are recorded in the audit log.'
              : 'A temporary password is generated and shown once when the account is created.'}
          </DialogDescription>
        </DialogHeader>

        {formError ? (
          <Alert variant="destructive" role="alert">
            <AlertDescription>{formError}</AlertDescription>
          </Alert>
        ) : null}

        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4" noValidate>
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Full name</FormLabel>
                  <FormControl>
                    <Input {...field} autoComplete="off" disabled={isSubmitting} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Work email</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      type="email"
                      inputMode="email"
                      autoCapitalize="none"
                      autoComplete="off"
                      placeholder="name@jaraaglobal.com"
                      disabled={isSubmitting}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="phone"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    Phone <span className="text-muted-foreground font-normal">(optional)</span>
                  </FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      value={field.value ?? ''}
                      type="tel"
                      inputMode="tel"
                      placeholder="+91 98765 43210"
                      disabled={isSubmitting}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="role"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Role</FormLabel>
                  <Select
                    value={field.value}
                    onValueChange={field.onChange}
                    disabled={isSubmitting}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {ASSIGNABLE_ROLES.map((value) => (
                        <SelectItem key={value} value={value}>
                          {ROLE_LABELS[value]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="departmentId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Department</FormLabel>
                  <Select
                    value={field.value ?? NO_DEPARTMENT}
                    onValueChange={(value) =>
                      field.onChange(value === NO_DEPARTMENT ? null : value)
                    }
                    disabled={isSubmitting || !needsDepartment}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Choose a department" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {!needsDepartment ? (
                        <SelectItem value={NO_DEPARTMENT}>No department</SelectItem>
                      ) : null}
                      {departments.map((department) => (
                        <SelectItem key={department.id} value={department.id}>
                          {department.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormDescription>
                    {needsDepartment
                      ? 'A member belongs to exactly one department.'
                      : 'The MD, deputy and administrator do not belong to a department.'}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => onOpenChange(false)}
                disabled={isSubmitting}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? <Loader2 className="size-4 animate-spin" /> : null}
                {editing ? 'Save changes' : 'Create user'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
