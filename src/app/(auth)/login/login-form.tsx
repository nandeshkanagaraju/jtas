'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { AlertCircle, Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { ApiError, apiPost } from '@/lib/api/client';
import { loginSchema, type LoginInput } from '@/lib/validation/auth';

interface LoginResponse {
  user: { role: 'MD' | 'DEPUTY_MD' | 'ADMIN' | 'MEMBER' };
  mustChangePassword: boolean;
}

/** Same mapping as the middleware's `landingPath`. */
function landingPath(role: LoginResponse['user']['role']): string {
  if (role === 'ADMIN') return '/users';
  if (role === 'MEMBER') return '/my-tasks';
  return '/dashboard';
}

export function LoginForm({ next }: { next?: string }) {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);

  // The same Zod schema the route handler validates against (rule 4), so the
  // client cannot accept something the server will reject.
  const form = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '', rememberDevice: false },
  });

  async function onSubmit(values: LoginInput) {
    setFormError(null);

    try {
      const result = await apiPost<LoginResponse>('/api/auth/login', values);

      // FR-03: a first login always goes through the change-password screen.
      const destination = result.mustChangePassword
        ? '/change-password'
        : (next ?? landingPath(result.user.role));

      // A full navigation rather than a client push: the session cookies were
      // just set, and the server components on the destination must be
      // rendered with them.
      window.location.assign(destination);
    } catch (error) {
      if (error instanceof ApiError) {
        // Field-level detail when the server gave it, a banner otherwise. The
        // credential failure is deliberately generic on the server side.
        if (error.fields) {
          for (const [field, messages] of Object.entries(error.fields)) {
            if (field in values) {
              form.setError(field as keyof LoginInput, { message: messages[0] });
            }
          }
        }
        setFormError(error.message);
      } else {
        setFormError('Could not reach the server. Check your connection and try again.');
      }
      router.refresh();
    }
  }

  const isSubmitting = form.formState.isSubmitting;

  return (
    <div className="bg-card border-border rounded-lg border p-6">
      <div className="mb-6 space-y-1">
        <h1 className="font-display text-lg font-semibold tracking-[-0.01em]">Sign in</h1>
        <p className="text-muted-foreground text-sm">
          Use the work email address your account was created with.
        </p>
      </div>

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
            name="email"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Email</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    type="email"
                    inputMode="email"
                    autoComplete="username"
                    autoCapitalize="none"
                    autoCorrect="off"
                    placeholder="you@jaraaglobal.com"
                    disabled={isSubmitting}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="password"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Password</FormLabel>
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
            name="rememberDevice"
            render={({ field }) => (
              <FormItem className="flex flex-row items-center gap-2 space-y-0">
                <FormControl>
                  <input
                    type="checkbox"
                    id="rememberDevice"
                    className="border-input accent-primary size-4 rounded border"
                    checked={field.value ?? false}
                    onChange={(event) => field.onChange(event.target.checked)}
                    disabled={isSubmitting}
                  />
                </FormControl>
                <FormLabel htmlFor="rememberDevice" className="text-sm font-normal">
                  Remember this device for 30 days
                </FormLabel>
              </FormItem>
            )}
          />

          <Button type="submit" className="w-full" disabled={isSubmitting}>
            {isSubmitting ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Signing in…
              </>
            ) : (
              'Sign in'
            )}
          </Button>
        </form>
      </Form>

      <p className="text-muted-foreground border-border mt-6 border-t pt-4 text-center text-xs">
        Accounts are created by the Managing Director or the administrator. If you cannot sign in,
        ask them to reset your password.
      </p>
    </div>
  );
}
