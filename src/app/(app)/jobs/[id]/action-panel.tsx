'use client';

import { Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

/**
 * The shape every MD action on a subtask shares: whatever the action needs,
 * then a reason, then confirm or cancel.
 *
 * The reason is mandatory and at least five characters, because it lands in the
 * audit log and "why was this deadline moved?" is exactly the question the
 * product exists to answer six months later.
 *
 * `override` is the second, optional confirmation the server asks for on the
 * two rules that warn rather than block — a deadline after the job's own, or an
 * assignee from another department.
 */
export function ActionPanel({
  title,
  note,
  reason,
  onReason,
  override,
  onOverride,
  busy,
  disabled,
  destructive,
  onCancel,
  onConfirm,
  children,
}: {
  title: string;
  note: string;
  reason: string;
  onReason: (value: string) => void;
  override?: string;
  onOverride?: (value: string) => void;
  busy: boolean;
  disabled?: boolean;
  destructive?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  children?: React.ReactNode;
}) {
  return (
    <div className="bg-muted/40 space-y-3 rounded-lg border p-3">
      <div className="space-y-0.5">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-muted-foreground text-xs">{note}</p>
      </div>

      {children}

      <div className="space-y-1.5">
        <Label className="text-xs">Reason</Label>
        <Textarea
          value={reason}
          onChange={(event) => onReason(event.target.value)}
          rows={2}
          maxLength={500}
          disabled={busy}
        />
      </div>

      {onOverride ? (
        <div className="space-y-1.5">
          <Label className="text-xs">
            Confirmation <span className="text-muted-foreground">(only if asked)</span>
          </Label>
          <Textarea
            value={override ?? ''}
            onChange={(event) => onOverride(event.target.value)}
            rows={2}
            maxLength={500}
            placeholder="Why this exception is correct"
            disabled={busy}
          />
        </div>
      ) : null}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button
          type="button"
          size="sm"
          variant={destructive ? 'destructive' : 'default'}
          onClick={onConfirm}
          disabled={busy || disabled || reason.trim().length < 5}
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : null}
          Confirm
        </Button>
      </div>
    </div>
  );
}
