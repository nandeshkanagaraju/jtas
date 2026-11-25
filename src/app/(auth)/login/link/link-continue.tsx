'use client';

import { T } from '@/lib/i18n/provider';

import { AlertCircle, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { ApiError, apiPost } from '@/lib/api/client';

import { landingPath } from '../login-form';

interface LoginResponse {
  user: { role: 'MD' | 'DEPUTY_MD' | 'ADMIN' | 'MEMBER' };
  mustChangePassword: boolean;
}

export function LinkContinue({ token }: { token: string | null }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(
    token ? null : 'This sign-in link is incomplete. Ask for a new one.',
  );

  async function signIn() {
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      const result = await apiPost<LoginResponse>('/api/auth/sign-in-link/consume', { token });
      window.location.assign(
        result.mustChangePassword ? '/change-password' : landingPath(result.user.role),
      );
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? cause.message
          : 'Could not reach the server. Check your connection and try again.',
      );
      setBusy(false);
    }
  }

  return (
    <div className="w-full">
      <div className="mb-6 space-y-1">
        <h1 className="font-display text-4xl font-medium tracking-[-0.05em]">
          <T>{'Sign in'}</T>
        </h1>
        <p className="text-muted-foreground text-sm">
          <T>{'Your sign-in request was approved. Continue to open JTAS on this device.'}</T>
        </p>
      </div>

      {error ? (
        <Alert variant="destructive" className="mb-4" role="alert">
          <AlertCircle className="size-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {token && !error ? (
        <Button type="button" className="w-full" disabled={busy} onClick={signIn}>
          {busy ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              <T>{'Signing in… '}</T>
            </>
          ) : (
            <T>{'Continue'}</T>
          )}
        </Button>
      ) : (
        <Button asChild variant="outline" className="w-full">
          <Link href="/login">
            <T>{'Back to sign in'}</T>
          </Link>
        </Button>
      )}
    </div>
  );
}
