'use client';

import { Loader2, TriangleAlert } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { ApiError } from '@/lib/api/client';
import type { OpenSubtaskSummary, UserRow } from '@/lib/api/users-client';
import { formatIST } from '@/lib/utils/time';

/**
 * Deactivation with a hand-over plan (FR-70, PDD section 12).
 *
 * The flow is deliberately two-step rather than a single "are you sure?": the
 * first attempt surfaces the open subtasks the server refused on, so the MD
 * sees exactly what is at stake before choosing who inherits it.
 */
export function DeactivateDialog({
  open,
  onOpenChange,
  user,
  candidates,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: UserRow | null;
  /** Active users in the same department, excluding administrators. */
  candidates: UserRow[];
  onConfirm: (body: { reassignTo?: string | null; reason?: string }) => Promise<void>;
}) {
  const [blocking, setBlocking] = useState<OpenSubtaskSummary[]>([]);
  const [reassignTo, setReassignTo] = useState<string | undefined>();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setBlocking([]);
      setReassignTo(undefined);
      setReason('');
      setError(null);
    }
  }, [open]);

  if (!user) return null;

  const needsReassignment = blocking.length > 0;

  async function confirm() {
    setBusy(true);
    setError(null);

    try {
      await onConfirm({ reassignTo: reassignTo ?? null, reason: reason.trim() || undefined });
    } catch (caught) {
      if (caught instanceof ApiError) {
        // The server tells us precisely what is in the way; render it rather
        // than asking the MD to go and look.
        const details = caught.details as { openSubtasks?: OpenSubtaskSummary[] } | undefined;
        if (details?.openSubtasks) setBlocking(details.openSubtasks);
        setError(caught.message);
      } else {
        setError('Could not reach the server. Check your connection and try again.');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Deactivate {user.name}?</DialogTitle>
          <DialogDescription>
            The account is switched off, not deleted — {user.name} stays visible on every job they
            worked on. Any signed-in device is signed out immediately.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {error ? (
            <Alert variant="destructive" role="alert">
              <TriangleAlert className="size-4" />
              <AlertTitle>Cannot deactivate yet</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          {needsReassignment ? (
            <div className="space-y-2">
              <p className="text-sm font-medium">
                Open work ({blocking.length}) that must move to somebody else
              </p>
              <ul className="max-h-56 space-y-2 overflow-y-auto rounded-md border p-2">
                {blocking.map((subtask) => (
                  <li key={subtask.id} className="rounded-md px-2 py-1.5 text-sm">
                    <div className="flex items-start justify-between gap-2">
                      <span className="font-medium">{subtask.title}</span>
                      <Badge variant="outline" className="shrink-0 text-xs">
                        {subtask.status}
                      </Badge>
                    </div>
                    <p className="text-muted-foreground text-xs">
                      {subtask.jobCode} · {subtask.departmentName} · due{' '}
                      <span className="tabular">{formatIST(new Date(subtask.deadline))}</span>
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {needsReassignment ? (
            <div className="space-y-2">
              <Label htmlFor="reassignTo">Hand the work over to</Label>
              {candidates.length === 0 ? (
                <Alert>
                  <AlertDescription>
                    Nobody else is active in this department. Add or reactivate somebody first, or
                    move the subtasks by hand.
                  </AlertDescription>
                </Alert>
              ) : (
                <Select value={reassignTo} onValueChange={setReassignTo} disabled={busy}>
                  <SelectTrigger id="reassignTo">
                    <SelectValue placeholder="Choose a replacement" />
                  </SelectTrigger>
                  <SelectContent>
                    {candidates.map((candidate) => (
                      <SelectItem key={candidate.id} value={candidate.id}>
                        {candidate.name}
                        {candidate.departmentName ? ` · ${candidate.departmentName}` : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          ) : null}

          <div className="space-y-2">
            <Label htmlFor="reason">
              Reason <span className="text-muted-foreground font-normal">(optional)</span>
            </Label>
            <Textarea
              id="reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Left the company, transferred, on long leave…"
              rows={2}
              maxLength={500}
              disabled={busy}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={confirm}
            disabled={busy || (needsReassignment && !reassignTo)}
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : null}
            {needsReassignment ? 'Reassign and deactivate' : 'Deactivate'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
