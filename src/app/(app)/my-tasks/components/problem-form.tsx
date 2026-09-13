'use client';

import { useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

/** SDD section 3.4 / FR-32. Re-checked by the API — this is only the hint. */
export const MIN_PROBLEM_DESCRIPTION = 20;

export type Severity = 'LOW' | 'MEDIUM' | 'HIGH' | 'BLOCKER';

const SEVERITIES: Array<{ value: Severity; label: string; className: string }> = [
  {
    value: 'LOW',
    label: 'Low',
    className: 'data-[on=true]:bg-muted data-[on=true]:text-foreground',
  },
  {
    value: 'MEDIUM',
    label: 'Medium',
    className: 'data-[on=true]:bg-state-progress data-[on=true]:text-white',
  },
  {
    value: 'HIGH',
    label: 'High',
    className: 'data-[on=true]:bg-state-problem data-[on=true]:text-white',
  },
  {
    value: 'BLOCKER',
    label: 'Blocker',
    className: 'data-[on=true]:bg-state-overdue data-[on=true]:text-white',
  },
];

/**
 * The inline "report problem" control (SDD section 7.2).
 *
 * Severity chips rather than a dropdown: on a phone a chip is one tap and a
 * dropdown is three. The character counter shows the 20-character minimum
 * before the member hits submit, so the rule is visible rather than punitive —
 * but the API enforces it regardless.
 */
export function ProblemForm({
  busy,
  autoFocus,
  onCancel,
  onSubmit,
}: {
  busy: boolean;
  autoFocus?: boolean;
  onCancel: () => void;
  onSubmit: (input: { note: string; severity: Severity }) => void;
}) {
  const [severity, setSeverity] = useState<Severity>('MEDIUM');
  const [note, setNote] = useState('');
  const textarea = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (autoFocus) textarea.current?.focus();
  }, [autoFocus]);

  const length = note.trim().length;
  const short = length < MIN_PROBLEM_DESCRIPTION;

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <p className="text-sm font-medium">How serious is it?</p>
        <div className="flex flex-wrap gap-2">
          {SEVERITIES.map((option) => (
            <button
              key={option.value}
              type="button"
              data-on={severity === option.value}
              onClick={() => setSeverity(option.value)}
              disabled={busy}
              className={cn(
                'min-h-11 rounded-full border px-4 text-sm transition-colors',
                'data-[on=false]:text-muted-foreground data-[on=false]:hover:bg-accent',
                option.className,
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-1.5">
        <p className="text-sm font-medium">What is the problem?</p>
        <Textarea
          ref={textarea}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          rows={3}
          maxLength={5000}
          disabled={busy}
          placeholder="Material short, tool broken, drawing mismatch…"
        />
        <p className={cn('text-xs', short ? 'text-muted-foreground' : 'text-state-complete')}>
          {short
            ? `${MIN_PROBLEM_DESCRIPTION - length} more character${
                MIN_PROBLEM_DESCRIPTION - length === 1 ? '' : 's'
              } — the MD needs enough to act on.`
            : `${length} characters.`}
        </p>
      </div>

      <div className="flex gap-2">
        <Button
          type="button"
          className="min-h-11 flex-1"
          disabled={busy || short}
          onClick={() => onSubmit({ note: note.trim(), severity })}
        >
          Send to the MD
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="min-h-11"
          onClick={onCancel}
          disabled={busy}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}
