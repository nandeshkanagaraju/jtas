'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { AlertCircle, Check, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
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
import { ApiError, apiPost } from '@/lib/api/client';
import { checkPasswordPolicy, passwordStrength } from '@/lib/auth/password-policy';
import { cn } from '@/lib/utils';
import { changePasswordSchema, type ChangePasswordInput } from '@/lib/validation/auth';

type Role = 'MD' | 'DEPUTY_MD' | 'ADMIN' | 'MEMBER';

function landingPath(role: Role): string {
  if (role === 'ADMIN') return '/users';
  if (role === 'MEMBER') return '/my-tasks';
  return '/dashboard';
}

const STRENGTH_LABELS = ['Too weak', 'Weak', 'Fair', 'Good', 'Strong'] as const;

const STRENGTH_BAR_COLOURS = [
  'bg-state-overdue',
  'bg-state-overdue',
  'bg-state-problem',
  'bg-state-progress',
  'bg-state-complete',
] as const;

/** Live strength hint. Presentational only — the server is the gate. */
function StrengthHint({ value }: { value: string }) {
  if (!value) return null;

  const score = passwordStrength(value);
  const { problems } = checkPasswordPolicy(value);

  return (
    <div className="space-y-1.5" aria-live="polite">
      <div className="flex items-center gap-2">
        <div className="bg-muted h-1.5 flex-1 overflow-hidden rounded-full">
          <div
            className={cn('h-full transition-all', STRENGTH_BAR_COLOURS[score])}
            style={{ width: `${((score + 1) / 5) * 100}%` }}
          />
        </div>
        <span className="text-muted-foreground w-16 text-right text-xs">
          {STRENGTH_LABELS[score]}
        </span>
      </div>

      {problems.length > 0 ? (
        <ul className="text-muted-foreground space-y-0.5 text-xs">
          {problems.map((problem) => (
            <li key={problem}>· {problem}</li>
          ))}
        </ul>
      ) : (
        <p className="text-state-complete flex items-center gap-1 text-xs">
          <Check className="size-3" />
          Meets the password policy.
        </p>
      )}
    </div>
  );
}

export function ChangePasswordForm({
  forced,
  role,
  email,
}: {
  forced: boolean;
  role: Role;
  email: string;
}) {
  const [formError, setFormError] = useState<string | null>(null);

  const form = useForm<ChangePasswordInput>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
    mode: 'onBlur',
  });

  const newPassword = form.watch('newPassword');
  const isSubmitting = form.formState.isSubmitting;

  async function onSubmit(values: ChangePasswordInput) {
    setFormError(null);

    try {
      await apiPost('/api/auth/change-password', values);
      // The change reissued the session cookies; a full navigation makes the
      // destination render with them.
      window.location.assign(landingPath(role));
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.fields) {
          for (const [field, messages] of Object.entries(error.fields)) {
            if (field in values) {
              form.setError(field as keyof ChangePasswordInput, { message: messages[0] });
            }
          }
        }
        setFormError(error.message);
      } else {
        setFormError('Could not reach the server. Check your connection and try again.');
      }
    }
  }

  return (
    <div className="bg-card rounded-lg border p-6 shadow-sm">
      <div className="mb-6 space-y-1">
        <h1 className="text-lg font-semibold">
          {forced ? 'Set your password' : 'Change password'}
        </h1>
        <p className="text-muted-foreground text-sm">
          Signed in as <span className="font-medium">{email}</span>
        </p>
      </div>

      {forced ? (
        <Alert className="mb-4">
          <AlertTitle>First sign-in</AlertTitle>
          <AlertDescription>
            Choose your own password before you continue. The temporary one stops working straight
            away.
          </AlertDescription>
        </Alert>
      ) : null}

      {formError ? (
        <Alert variant="destructive" className="mb-4" role="alert">
          <AlertCircle className="size-4" />
          <AlertDescription>{formError}</AlertDescription>
        </Alert>
      ) : null}

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
          <FormField
            control={form.control}
            name="currentPassword"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{forced ? 'Temporary password' : 'Current password'}</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    type="password"
                    autoComplete="current-password"
                    disabled={isSubmitting}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="newPassword"
            render={({ field }) => (
              <FormItem>
                <FormLabel>New password</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    type="password"
                    autoComplete="new-password"
                    disabled={isSubmitting}
                  />
                </FormControl>
                <FormDescription>
                  At least 8 characters, including a letter and a digit.
                </FormDescription>
                <StrengthHint value={newPassword} />
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="confirmPassword"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Confirm new password</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    type="password"
                    autoComplete="new-password"
                    disabled={isSubmitting}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <Button type="submit" className="w-full" disabled={isSubmitting}>
            {isSubmitting ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Saving…
              </>
            ) : (
              'Save password'
            )}
          </Button>
        </form>
      </Form>

      <p className="text-muted-foreground mt-6 text-center text-xs">
        Changing your password signs you out of every other device.
      </p>
    </div>
  );
}
