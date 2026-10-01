'use client';

import { useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

/** SDD section 3.4 / FR-32. Re-checked by the API — this is only the hint. */
export const MIN_PROBLEM_DESCRIPTION = 20;

export type Severity = 'LOW' | 'MEDIUM' | 'HIGH' | 'BLOCKER';

const SEVERITIES: Array<{ value: Severity; label: string }> = [
  { value: 'LOW', label: 'Low' },
  { value: 'MEDIUM', label: 'Medium' },
  { value: 'HIGH', label: 'High' },
  { value: 'BLOCKER', label: 'Blocker' },
];

/**
 * The inline report (SDD section 7.2).
 *
 * Severity chips rather than a dropdown: on a phone a chip is one tap and a
 * dropdown is three. The character counter shows the 20-character minimum
 * before the member hits submit, so the rule is visible rather than punitive —
 * but the API enforces it regardless. The submit button uses the same words as
 * the button that opened this form.
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
  const remaining = MIN_PROBLEM_DESCRIPTION - length;

  return (
    <div className="space-y-3">
      <p className="text-foreground text-base font-semibold">Report problem</p>

      <fieldset className="space-y-2" disabled={busy}>
        <legend className="text-foreground text-base">Severity</legend>
        <div className="flex flex-wrap gap-2">
          {SEVERITIES.map((option) => {
            const selected = severity === option.value;
            return (
              <button
                key={option.value}
                type="button"
                aria-pressed={selected}
                onClick={() => setSeverity(option.value)}
                className={cn(
                  'focus-visible:outline-ring min-h-11 rounded-sm border-2 px-3 text-base focus-visible:outline-2 focus-visible:outline-offset-2',
                  selected
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border bg-card text-foreground',
                )}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </fieldset>

      <div className="space-y-1.5">
        <label htmlFor="problem-note" className="text-foreground text-base">
          What stopped the work?
        </label>
        <Textarea
          id="problem-note"
          ref={textarea}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          rows={3}
          maxLength={5000}
          disabled={busy}
          placeholder="Tool broken, material short, drawing wrong."
          className="text-base"
        />
        {short ? (
          <p className="text-foreground text-sm">
            {remaining} more {remaining === 1 ? 'character' : 'characters'}. Say what stopped the
            work.
          </p>
        ) : null}
      </div>

      <div className="flex gap-2">
        <Button
          type="button"
          className="bg-primary text-primary-foreground hover:bg-primary focus-visible:outline-ring h-auto min-h-12 flex-1 rounded-lg text-base font-semibold shadow-none focus-visible:outline-2 focus-visible:outline-offset-2 motion-reduce:transition-none"
          disabled={busy || short}
          onClick={() => onSubmit({ note: note.trim(), severity })}
        >
          Report problem
        </Button>
        <Button
          type="button"
          variant="outline"
          className="border-border bg-card text-foreground hover:bg-card focus-visible:outline-ring h-auto min-h-12 rounded-lg border text-base shadow-none focus-visible:outline-2 focus-visible:outline-offset-2 motion-reduce:transition-none"
          onClick={onCancel}
          disabled={busy}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}
