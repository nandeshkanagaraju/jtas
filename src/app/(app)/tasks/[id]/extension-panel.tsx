'use client';

import { Clock, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { IstDateTimePicker } from '@/components/shared/ist-datetime-picker';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ApiError } from '@/lib/api/client';
import { requestExtensionRequest, type ExtensionRequestDto } from '@/lib/api/my-tasks-client';
import { EXTENSION_REASON_MIN } from '@/lib/validation/extension';
import { cn } from '@/lib/utils';
import { formatIST } from '@/lib/utils/time';

const STATUS_STYLES: Record<string, string> = {
  PENDING: 'bg-state-problem text-white',
  APPROVED: 'bg-state-complete text-white',
  REJECTED: 'bg-muted text-muted-foreground border border-border',
};

/**
 * "Request more time" — FR-33, improvement I-11.
 *
 * The honest member's alternative to silence. A member cannot move their own
 * deadline (FR-35), so this asks; the MD decides, and the answer is visible
 * here rather than arriving by phone.
 */
export function ExtensionPanel({
  subtaskId,
  currentDeadline,
  requests,
  onChanged,
}: {
  subtaskId: string;
  currentDeadline: string;
  requests: ExtensionRequestDto[];
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [requestedDeadline, setRequestedDeadline] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const pending = requests.find((request) => request.status === 'PENDING');
  const latest = requests[0];
  const short = reason.trim().length < EXTENSION_REASON_MIN;

  async function submit() {
    setBusy(true);
    try {
      await requestExtensionRequest(subtaskId, { requestedDeadline, reason: reason.trim() });
      toast.success('Asked the MD for more time.');
      setOpen(false);
      setReason('');
      onChanged();
    } catch (error) {
      toast.error(
        error instanceof ApiError ? error.message : 'Could not reach the server. Try again.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Clock className="size-4" />
          More time
        </CardTitle>
        <CardDescription>
          You cannot move your own deadline, but you can ask. The MD decides.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-3">
        {latest ? (
          <div className="bg-card flex flex-wrap items-center justify-between gap-2 rounded-md border p-3">
            <div className="space-y-0.5">
              <p className="text-sm">
                Asked for{' '}
                <span className="tabular font-medium">
                  {formatIST(new Date(latest.requestedDeadline))}
                </span>
              </p>
              <p className="text-muted-foreground text-xs">{latest.reason}</p>
            </div>
            <Badge className={cn('whitespace-nowrap', STATUS_STYLES[latest.status])}>
              {latest.status === 'PENDING'
                ? 'Waiting for the MD'
                : latest.status === 'APPROVED'
                  ? 'Approved'
                  : 'Not approved'}
            </Badge>
          </div>
        ) : null}

        {pending ? (
          <p className="text-muted-foreground text-xs">
            One request at a time — the MD has this one.
          </p>
        ) : open ? (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="extension-new-deadline" className="text-xs">
                New deadline you need (currently {formatIST(new Date(currentDeadline))})
              </Label>
              <IstDateTimePicker
                id="extension-new-deadline"
                value={requestedDeadline}
                onChange={setRequestedDeadline}
                disabled={busy}
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Why?</Label>
              <Textarea
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                rows={3}
                maxLength={1000}
                disabled={busy}
                placeholder="The tooling supplier has slipped by four days…"
              />
              <p className="text-muted-foreground text-xs">
                {short
                  ? `${EXTENSION_REASON_MIN - reason.trim().length} more characters — the MD needs enough to decide.`
                  : `${reason.trim().length} characters.`}
              </p>
            </div>

            <div className="flex gap-2">
              <Button
                className="min-h-11 flex-1"
                disabled={busy || short || requestedDeadline === ''}
                onClick={submit}
              >
                {busy ? <Loader2 className="size-4 animate-spin" /> : null}
                Ask the MD
              </Button>
              <Button
                variant="ghost"
                className="min-h-11"
                onClick={() => setOpen(false)}
                disabled={busy}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <Button variant="outline" className="min-h-11" onClick={() => setOpen(true)}>
            Request more time
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
