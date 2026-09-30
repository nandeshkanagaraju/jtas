'use client';

import { CalendarIcon } from 'lucide-react';
import { useId, useMemo } from 'react';

import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

/**
 * Picks a date and a time in **IST**, and emits a naive `YYYY-MM-DDTHH:mm`
 * string.
 *
 * The value never becomes a `Date` on the client. That is the whole point: a
 * browser in any timezone would attach its own offset, and the deadline the MD
 * typed would stop being the deadline the scheduler uses. The string carries
 * exactly what was chosen, and the server converts it once with `fromISTInput`
 * (architecture rule 1).
 *
 * The field accepts any minute. Fifteen-minute marks stay as suggestions in
 * the datalist, which is what a shop-floor deadline usually wants, without
 * refusing 21:07 when somebody is testing a reminder.
 */
export const QUICK_PICK_MINUTES = 15;

/** The `<input type="time">` step, in minutes. `step` on that input is seconds. */
export const TIME_STEP_MINUTES = 1;

/** `["00:00", "00:15", … "23:45"]` at the default step. */
export function buildTimeOptions(stepMinutes = QUICK_PICK_MINUTES): string[] {
  const options: string[] = [];
  for (let minutes = 0; minutes < 24 * 60; minutes += stepMinutes) {
    const hh = String(Math.floor(minutes / 60)).padStart(2, '0');
    const mm = String(minutes % 60).padStart(2, '0');
    options.push(`${hh}:${mm}`);
  }
  return options;
}

/** Splits `2026-10-15T16:30` into its two halves. */
export function splitIstValue(value: string): { date: string; time: string } {
  const [date = '', time = ''] = value.split('T');
  return { date, time };
}

/** Formats a calendar selection as `YYYY-MM-DD` using its local fields. */
function toDateKey(date: Date): string {
  // The Calendar hands back a Date whose *local* fields are the day the user
  // clicked. Reading those fields directly — rather than going through
  // toISOString() — is what keeps the choice from shifting a day either way.
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

/** Parses `YYYY-MM-DD` back into a Date with those local fields. */
function fromDateKey(key: string): Date | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!match) return undefined;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

export function IstDateTimePicker({
  value,
  onChange,
  disabled,
  id,
  /** Days before this cannot be chosen; defaults to today. */
  minDate,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  id?: string;
  minDate?: Date;
}) {
  const { date, time } = splitIstValue(value);
  const suggestions = useMemo(() => buildTimeOptions(QUICK_PICK_MINUTES), []);
  const listId = useId();

  const selected = fromDateKey(date);
  const floor = minDate ?? new Date(new Date().setHours(0, 0, 0, 0));

  return (
    <div className="flex gap-2">
      <Popover>
        <PopoverTrigger asChild>
          <Button
            id={id}
            type="button"
            variant="outline"
            disabled={disabled}
            className={cn('flex-1 justify-start font-normal', !date && 'text-muted-foreground')}
          >
            <CalendarIcon className="size-4" />
            {selected
              ? selected.toLocaleDateString('en-IN', {
                  day: '2-digit',
                  month: 'short',
                  year: 'numeric',
                })
              : 'Choose a date'}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={selected}
            defaultMonth={selected}
            disabled={(day) => day < floor}
            onSelect={(day) => {
              if (!day) return;
              // Default to 18:00 IST — the end of the working day, which is
              // what a deadline usually means (working_hours.end).
              onChange(`${toDateKey(day)}T${time || '18:00'}`);
            }}
            autoFocus
          />
        </PopoverContent>
      </Popover>

      <Input
        type="time"
        step={TIME_STEP_MINUTES * 60}
        list={listId}
        aria-label="Time (IST)"
        value={time}
        disabled={disabled}
        className="tabular w-32"
        onChange={(event) => {
          const next = event.target.value;
          if (!/^\d{2}:\d{2}$/.test(next)) return;
          onChange(`${date || toDateKey(new Date())}T${next}`);
        }}
      />
      <datalist id={listId}>
        {suggestions.map((option) => (
          <option key={option} value={option} />
        ))}
      </datalist>
    </div>
  );
}
