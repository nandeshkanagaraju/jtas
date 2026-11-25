'use client';

import { T } from '@/lib/i18n/provider';

import { zodResolver } from '@hookform/resolvers/zod';
import { AlertCircle, Loader2, MailCheck, XCircle } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
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
import {
  loginSchema,
  signInLinkRequestSchema,
  type LoginInput,
  type SignInLinkRequestInput,
} from '@/lib/validation/auth';

interface LoginResponse {
  user: { role: 'MD' | 'DEPUTY_MD' | 'ADMIN' | 'MEMBER' };
  mustChangePassword: boolean;
}

type RequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED' | 'USED';

/** Same mapping as the middleware's `landingPath`. */
export function landingPath(role: LoginResponse['user']['role']): string {
  if (role === 'ADMIN') return '/users';
  if (role === 'MEMBER') return '/my-tasks';
  return '/dashboard';
}

function messageFor(error: unknown): string {
  return error instanceof ApiError
    ? error.message
    : 'Could not reach the server. Check your connection and try again.';
}

/** How often the waiting screen asks whether the developer has answered. */
const POLL_MS = 4000;

export function LoginForm({ next }: { next?: string }) {
  const [mode, setMode] = useState<'link' | 'password'>('link');

  return (
    <div className="w-full">
      <div className="mb-6 space-y-1">
        <h1 className="font-display text-4xl font-medium tracking-[-0.05em]">
          <T>{'Sign in'}</T>
        </h1>
        <p className="text-muted-foreground text-sm">
          {mode === 'link' ? (
            <T>{'Enter your work email. Once approved, a sign-in link is mailed to you.'}</T>
          ) : (
            <T>{'Enter your work credentials to access production. '}</T>
          )}
        </p>
      </div>

      {mode === 'link' ? <LinkSignIn /> : <PasswordSignIn next={next} />}

      <div className="mt-5 text-center">
        <Button
          type="button"
          variant="link"
          className="h-auto p-0 text-sm"
          onClick={() => setMode(mode === 'link' ? 'password' : 'link')}
        >
          {mode === 'link' ? (
            <T>{'Use password instead'}</T>
          ) : (
            <T>{'Get a sign-in link instead'}</T>
          )}
        </Button>
      </div>

      <p className="text-muted-foreground border-border mt-6 border-t pt-4 text-center text-xs">
        <T>
          {
            'Accounts are created by the Managing Director or the administrator. If you cannot sign in, ask them for help. '
          }
        </T>
      </p>
    </div>
  );
}

/** Primary: ask for a link, wait for the developer, then check the mailbox. */
function LinkSignIn() {
  const [formError, setFormError] = useState<string | null>(null);
  const [waiting, setWaiting] = useState<{
    handle: string;
    email: string;
    until: number;
  } | null>(null);
  const [status, setStatus] = useState<RequestStatus>('PENDING');

  const form = useForm<SignInLinkRequestInput>({
    resolver: zodResolver(signInLinkRequestSchema),
    defaultValues: { email: '', rememberDevice: false },
  });

  useEffect(() => {
    if (!waiting || status !== 'PENDING') return;

    let cancelled = false;
    const timer = setInterval(async () => {
      if (Date.now() > waiting.until) {
        setStatus('EXPIRED');
        return;
      }
      try {
        const result = await apiPost<{ status: RequestStatus }>('/api/auth/sign-in-link/status', {
          handle: waiting.handle,
        });
        if (!cancelled) setStatus(result.status);
      } catch {
        // A dropped poll is retried on the next tick.
      }
    }, POLL_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [waiting, status]);

  async function onSubmit(values: SignInLinkRequestInput) {
    setFormError(null);
    try {
      const result = await apiPost<{ handle: string; waitMinutes: number }>(
        '/api/auth/sign-in-link/request',
        values,
      );
      setStatus('PENDING');
      setWaiting({
        handle: result.handle,
        email: values.email,
        until: Date.now() + result.waitMinutes * 60_000,
      });
    } catch (error) {
      setFormError(messageFor(error));
    }
  }

  function startOver() {
    setWaiting(null);
    setStatus('PENDING');
  }

  if (waiting) {
    return (
      <div className="space-y-4" aria-live="polite">
        {status === 'PENDING' ? (
          <Alert>
            <Loader2 className="size-4 animate-spin" />
            <AlertDescription>
              <span className="text-foreground block font-medium">
                <T>{'Waiting for approval'}</T>
              </span>
              <T>
                {
                  'Your request has been sent. Keep this page open; it updates by itself once the request is answered.'
                }
              </T>
            </AlertDescription>
          </Alert>
        ) : null}

        {status === 'APPROVED' || status === 'USED' ? (
          <Alert>
            <MailCheck className="size-4" />
            <AlertDescription>
              <span className="text-foreground block font-medium">
                <T>{'Approved. Check your email'}</T>
              </span>
              <T values={{ email: waiting.email }}>
                {
                  'A sign-in link was sent to {{email}}. Open it on this device or any other to sign in. It works once and expires in 15 minutes.'
                }
              </T>
            </AlertDescription>
          </Alert>
        ) : null}

        {status === 'REJECTED' ? (
          <Alert variant="destructive">
            <XCircle className="size-4" />
            <AlertDescription>
              <T>
                {'This sign-in request was declined. Contact the administrator if you need access.'}
              </T>
            </AlertDescription>
          </Alert>
        ) : null}

        {status === 'EXPIRED' ? (
          <Alert variant="destructive">
            <AlertCircle className="size-4" />
            <AlertDescription>
              <T>{'The request was not answered in time. Ask again.'}</T>
            </AlertDescription>
          </Alert>
        ) : null}

        <Button type="button" variant="outline" className="w-full" onClick={startOver}>
          {status === 'PENDING' ? <T>{'Back'}</T> : <T>{'Start again'}</T>}
        </Button>
      </div>
    );
  }

  const isSubmitting = form.formState.isSubmitting;

  return (
    <>
      {formError ? (
        <Alert variant="destructive" className="mb-4" role="alert">
          <AlertCircle className="size-4" />
          <AlertDescription>{formError}</AlertDescription>
        </Alert>
      ) : null}

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
          <EmailField control={form.control} disabled={isSubmitting} />
          <RememberField control={form.control} disabled={isSubmitting} />

          <Button type="submit" className="w-full" disabled={isSubmitting}>
            {isSubmitting ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                <T>{'Sending request… '}</T>
              </>
            ) : (
              <T>{'Request sign-in link'}</T>
            )}
          </Button>
        </form>
      </Form>
    </>
  );
}

/** Fallback: the organisation-set password. */
function PasswordSignIn({ next }: { next?: string }) {
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
      if (error instanceof ApiError && error.fields) {
        for (const [field, messages] of Object.entries(error.fields)) {
          if (field in values) {
            form.setError(field as keyof LoginInput, { message: messages[0] });
          }
        }
      }
      setFormError(messageFor(error));
      router.refresh();
    }
  }

  const isSubmitting = form.formState.isSubmitting;

  return (
    <>
      {formError ? (
        <Alert variant="destructive" className="mb-4" role="alert">
          <AlertCircle className="size-4" />
          <AlertDescription>{formError}</AlertDescription>
        </Alert>
      ) : null}

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
          <EmailField control={form.control} disabled={isSubmitting} />

          <FormField
            control={form.control}
            name="password"
            render={({ field }) => (
              <FormItem>
                <FormLabel>
                  <T>{'Password'}</T>
                </FormLabel>
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

          <RememberField control={form.control} disabled={isSubmitting} />

          <Button type="submit" className="w-full" disabled={isSubmitting}>
            {isSubmitting ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                <T>{'Signing in… '}</T>
              </>
            ) : (
              <T>{'Sign in'}</T>
            )}
          </Button>
        </form>
      </Form>
    </>
  );
}

/*
 * Shared fields. Both forms have `email` and `rememberDevice`, so one control
 * type covers either.
 */
type SharedControl = ReturnType<typeof useForm<SignInLinkRequestInput>>['control'];

function EmailField({ control, disabled }: { control: unknown; disabled: boolean }) {
  return (
    <FormField
      control={control as SharedControl}
      name="email"
      render={({ field }) => (
        <FormItem>
          <FormLabel>
            <T>{'Email'}</T>
          </FormLabel>
          <FormControl>
            <Input
              {...field}
              type="email"
              inputMode="email"
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              placeholder="you@jaraaglobal.com"
              disabled={disabled}
            />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

function RememberField({ control, disabled }: { control: unknown; disabled: boolean }) {
  return (
    <FormField
      control={control as SharedControl}
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
              disabled={disabled}
            />
          </FormControl>
          <FormLabel htmlFor="rememberDevice" className="text-sm font-normal">
            <T>{'Remember this device for 30 days '}</T>
          </FormLabel>
        </FormItem>
      )}
    />
  );
}
