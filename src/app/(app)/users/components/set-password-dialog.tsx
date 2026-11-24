'use client';

import { T } from '@/lib/i18n/provider';

import { Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError } from '@/lib/api/client';
import { setPasswordRequest, type UserRow } from '@/lib/api/users-client';
import { checkPasswordPolicy } from '@/lib/auth/password-policy';

/**
 * Developer only: set an account's password to a chosen value. The server
 * checks the developer allowlist and the password policy again.
 */
export function SetPasswordDialog({
  user,
  onOpenChange,
  onDone,
}: {
  user: UserRow | null;
  onOpenChange: (open: boolean) => void;
  onDone: (user: UserRow) => void;
}) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setPassword('');
    setConfirm('');
    setError(null);
  }, [user?.id]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!user) return;
    const policy = checkPasswordPolicy(password);
    if (!policy.valid) return setError(policy.problems[0]);
    if (password !== confirm) return setError('The two passwords do not match.');

    setBusy(true);
    setError(null);
    try {
      await setPasswordRequest(user.id, password);
      onDone(user);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Could not set the password.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={user !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>
              <T>{'Set password'}</T>
            </DialogTitle>
            <DialogDescription>
              {user ? `${user.name} · ${user.email}` : null}
              <br />
              <T>{'They are signed out everywhere and sign in with the new password.'}</T>
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor="set-password-new">
              <T>{'New password'}</T>
            </Label>
            <Input
              id="set-password-new"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="set-password-confirm">
              <T>{'Confirm password'}</T>
            </Label>
            <Input
              id="set-password-confirm"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
            />
          </div>

          {error ? (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              <T>{'Cancel'}</T>
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : null}
              <T>{'Set password'}</T>
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
