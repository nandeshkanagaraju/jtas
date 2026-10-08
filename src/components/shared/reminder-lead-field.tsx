'use client';

import { useEffect, useState } from 'react';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  minutesFromAmount,
  reminderConfirmation,
  reminderLeadProblem,
  splitReminderLead,
  SUBTASK_LEAD_MAX_MINUTES,
  type ReminderUnit,
} from '@/lib/domain/reminder-lead';
import { cn } from '@/lib/utils';

/**
 * A reminder lead as a whole number and a unit.
 *
 * The parent stores minutes. This control converts, and it says the moment
 * that conversion produces so a person can see what was understood.
 */
export function ReminderLeadField({
  id,
  minutes,
  onMinutes,
  deadline,
  maxMinutes = SUBTASK_LEAD_MAX_MINUTES,
  invalid = false,
  hideLabel = false,
}: {
  id: string;
  minutes: number;
  onMinutes: (minutes: number) => void;
  /** When the reminder would fire, if the deadline is already known. */
  deadline?: Date | null;
  maxMinutes?: number;
  invalid?: boolean;
  /** Settings already titles the row. The wizard uses the built-in label. */
  hideLabel?: boolean;
}) {
  const initial = splitReminderLead(minutes);
  const [amount, setAmount] = useState(String(initial.amount));
  const [unit, setUnit] = useState<ReminderUnit>(initial.unit);

  // A template or a saved subtask can replace the minutes from outside.
  // Typing stays local until that happens, so a half-written "1" is not
  // snapped back to the previous value on every keystroke.
  useEffect(() => {
    if (!Number.isInteger(minutes) || minutes < 1) return;
    const split = splitReminderLead(minutes);
    const shown = minutesFromAmount(amount, unit);
    if (shown === minutes) return;
    setAmount(String(split.amount));
    setUnit(split.unit);
    // `amount` and `unit` are read to see whether the field already shows
    // `minutes`. Including them would reset the field on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [minutes]);

  const problem = reminderLeadProblem(amount, unit, maxMinutes);
  const resolved =
    problem === null
      ? reminderConfirmation(minutesFromAmount(amount, unit)!, deadline ?? null)
      : null;

  function publish(nextAmount: string, nextUnit: ReminderUnit) {
    const next = minutesFromAmount(nextAmount, nextUnit);
    if (next === null || reminderLeadProblem(nextAmount, nextUnit, maxMinutes)) {
      onMinutes(Number.NaN);
      return;
    }
    onMinutes(next);
  }

  return (
    <div className="space-y-1.5">
      {hideLabel ? null : (
        <Label htmlFor={id} className="text-xs">
          Reminder
        </Label>
      )}
      <div className="flex gap-2">
        <Input
          id={id}
          inputMode="numeric"
          aria-label="Reminder amount"
          aria-invalid={invalid || problem !== null}
          aria-describedby={resolved || problem ? `${id}-hint` : undefined}
          className={cn('code w-20', (invalid || problem) && 'border-destructive')}
          value={amount}
          onChange={(event) => {
            setAmount(event.target.value);
            publish(event.target.value, unit);
          }}
        />
        <select
          aria-label="Reminder unit"
          value={unit}
          onChange={(event) => {
            const next = event.target.value as ReminderUnit;
            setUnit(next);
            publish(amount, next);
          }}
          className="border-input bg-card hover:bg-muted h-9 rounded-md border px-2 text-sm transition-colors"
        >
          <option value="minutes">Minutes</option>
          <option value="hours">Hours</option>
          <option value="days">Days</option>
        </select>
      </div>
      {problem ? (
        <p id={`${id}-hint`} className="text-destructive text-xs">
          {problem}
        </p>
      ) : resolved ? (
        <p id={`${id}-hint`} className="text-muted-foreground text-xs">
          {resolved}
        </p>
      ) : null}
    </div>
  );
}
