'use client';

import { TriangleAlert } from 'lucide-react';

import { CopyableSecret } from '@/components/shared/copyable-secret';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

/**
 * Shows a temporary password once.
 *
 * The server stores only a bcrypt hash, so this really is the only time the
 * value exists in readable form — the warning is a statement of fact, not
 * caution. Closing the dialog is deliberately the only action: there is no
 * "show again", because there is nothing to show again.
 */
export function TemporaryPasswordDialog({
  open,
  onOpenChange,
  userName,
  userEmail,
  password,
  context,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userName: string;
  userEmail: string;
  password: string;
  context: 'created' | 'reset';
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{context === 'created' ? 'Account created' : 'Password reset'}</DialogTitle>
          <DialogDescription>
            {context === 'created'
              ? `${userName} can now sign in with the temporary password below.`
              : `${userName} must now sign in with the temporary password below.`}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <p className="text-muted-foreground text-sm">Email</p>
            <p className="font-medium">{userEmail}</p>
          </div>

          <div className="space-y-1.5">
            <p className="text-muted-foreground text-sm">Temporary password</p>
            <CopyableSecret value={password} />
          </div>

          <Alert variant="destructive">
            <TriangleAlert className="size-4" />
            <AlertTitle>Shown only once</AlertTitle>
            <AlertDescription>
              Only an encrypted form is stored, so this password cannot be shown again. Copy it now
              and hand it over. If it is lost, reset the password to issue a new one. {userName}{' '}
              must change it at first sign-in.
            </AlertDescription>
          </Alert>
        </div>

        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>I have copied it</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
