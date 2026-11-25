'use client';

import { T } from '@/lib/i18n/provider';

import { Check, Loader2, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ApiError, apiFetch, apiPost } from '@/lib/api/client';
import type { SignInRequestRow } from '@/lib/services/auth';

interface Queue {
  pending: SignInRequestRow[];
  recent: SignInRequestRow[];
}

const STATUS_LABELS: Record<string, string> = {
  APPROVED: 'Link sent',
  USED: 'Signed in',
  REJECTED: 'Declined',
  EXPIRED: 'Expired',
};

function when(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** A short, readable device description from the user agent. */
function device(userAgent: string | null): string | null {
  if (!userAgent) return null;
  const os = /Android/.test(userAgent)
    ? 'Android'
    : /iPhone|iPad/.test(userAgent)
      ? 'iPhone / iPad'
      : /Windows/.test(userAgent)
        ? 'Windows'
        : /Mac OS X/.test(userAgent)
          ? 'Mac'
          : /Linux/.test(userAgent)
            ? 'Linux'
            : null;
  const browser = /Edg\//.test(userAgent)
    ? 'Edge'
    : /Chrome\//.test(userAgent)
      ? 'Chrome'
      : /Firefox\//.test(userAgent)
        ? 'Firefox'
        : /Safari\//.test(userAgent)
          ? 'Safari'
          : null;
  return [browser, os].filter(Boolean).join(' on ') || null;
}

export function SignInRequestsScreen({ initial }: { initial: Queue }) {
  const router = useRouter();
  const [queue, setQueue] = useState<Queue>(initial);
  const [busy, setBusy] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setQueue(await apiFetch<Queue>('/api/sign-in-requests'));
    } catch {
      // The next tick tries again.
    }
  }, []);

  // New requests appear without a refresh.
  useEffect(() => {
    const timer = setInterval(reload, 5000);
    return () => clearInterval(timer);
  }, [reload]);

  async function answer(row: SignInRequestRow, verb: 'approve' | 'reject') {
    setBusy(row.id);
    try {
      await apiPost(`/api/sign-in-requests/${row.id}/${verb}`, {});
      toast.success(
        verb === 'approve'
          ? `Sign-in link mailed to ${row.user.email}.`
          : `Declined the request from ${row.user.name}.`,
      );
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Could not reach the server.');
    } finally {
      setBusy(null);
      await reload();
      // Refreshes the nav badge.
      router.refresh();
    }
  }

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 px-4 py-6">
      <div className="space-y-1">
        <h1 className="font-display text-3xl font-medium tracking-[-0.04em]">
          <T>{'Sign-in requests'}</T>
        </h1>
        <p className="text-muted-foreground text-sm">
          <T>
            {
              'Accept a request only when you know the person is signing in now. Accepting mails a one-time link to their own address; it works for 15 minutes.'
            }
          </T>
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            <T>{'Waiting'}</T> ({queue.pending.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {queue.pending.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              <T>{'Nobody is waiting to sign in.'}</T>
            </p>
          ) : (
            queue.pending.map((row) => (
              <div
                key={row.id}
                className="border-border flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0 space-y-1">
                  <p className="font-medium">
                    {row.user.name}{' '}
                    <span className="text-muted-foreground font-normal">· {row.user.role}</span>
                    {row.user.department ? (
                      <span className="text-muted-foreground font-normal">
                        {' '}
                        · {row.user.department}
                      </span>
                    ) : null}
                  </p>
                  <p className="text-muted-foreground truncate text-sm">{row.user.email}</p>
                  <p className="text-muted-foreground text-xs">
                    {when(row.createdAt)}
                    {device(row.userAgent) ? ` · ${device(row.userAgent)}` : ''}
                    {row.ipAddress ? ` · ${row.ipAddress}` : ''}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button
                    variant="outline"
                    disabled={busy !== null}
                    onClick={() => answer(row, 'reject')}
                  >
                    <X className="size-4" />
                    <T>{'Decline'}</T>
                  </Button>
                  <Button disabled={busy !== null} onClick={() => answer(row, 'approve')}>
                    {busy === row.id ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Check className="size-4" />
                    )}
                    <T>{'Accept and send link'}</T>
                  </Button>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {queue.recent.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              <T>{'Last 24 hours'}</T>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-border divide-y">
              {queue.recent.map((row) => (
                <li key={row.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span className="min-w-0 truncate">
                    {row.user.name}{' '}
                    <span className="text-muted-foreground">· {when(row.createdAt)}</span>
                  </span>
                  <Badge variant={row.status === 'REJECTED' ? 'destructive' : 'secondary'}>
                    <T>{STATUS_LABELS[row.status] ?? row.status}</T>
                  </Badge>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
