'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { AlertTriangle, Loader2, Save, Send } from 'lucide-react';
import { toast } from 'sonner';

import { ReminderLeadField } from '@/components/shared/reminder-lead-field';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError, apiFetch } from '@/lib/api/client';
import { SETTINGS_LEAD_MAX_MINUTES } from '@/lib/domain/reminder-lead';
import { previewReminder } from '@/lib/domain/reminder-preview';
import { SETTING_GROUPS, type SettingGroup } from '@/lib/domain/settings-definitions';
import { toWorkingHoursConfig } from '@/lib/notifications/working-hours';
import type { SettingView } from '@/lib/services/settings';
import { cn } from '@/lib/utils';
import { fromISTInput } from '@/lib/utils/time';

const DAYS = [
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
  { value: 0, label: 'Sun' },
];

type Draft = Record<string, unknown>;

export function SettingsForm({ initial }: { initial: SettingView[] }) {
  const router = useRouter();
  const [rows, setRows] = useState(initial);
  const [draft, setDraft] = useState<Draft>({});
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [saving, setSaving] = useState(false);

  const byKey = useMemo(() => new Map(rows.map((row) => [row.key, row])), [rows]);

  /** The current value of a key: the unsaved edit if there is one. */
  function valueOf(key: string): unknown {
    return key in draft ? draft[key] : byKey.get(key)?.value;
  }

  function set(key: string, value: unknown) {
    setDraft((current) => ({ ...current, [key]: value }));
    setErrors((current) => {
      if (!(key in current)) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  }

  const dirty = Object.keys(draft).length > 0;

  async function save() {
    setSaving(true);
    setErrors({});

    try {
      const result = await apiFetch<{ data: SettingView[]; changed: unknown[] }>('/api/settings', {
        method: 'PUT',
        body: JSON.stringify({ settings: draft }),
      });

      setRows(result.data);
      setDraft({});

      toast.success(
        result.changed.length === 0
          ? 'Nothing had changed.'
          : `${result.changed.length} setting${result.changed.length > 1 ? 's' : ''} saved.`,
      );

      // The nav and any server-rendered copy of a setting refresh with it.
      router.refresh();
    } catch (error) {
      if (error instanceof ApiError && error.fields) {
        setErrors(error.fields);
        toast.error(error.message);
      } else {
        toast.error(error instanceof Error ? error.message : 'Could not save.');
      }
    } finally {
      setSaving(false);
    }
  }

  /*
   * The live preview (build spec M9.2). Built from the *unsaved* values, so the
   * operator sees the consequence of the change they are about to make rather
   * than the one already in force.
   */
  const preview = useMemo(() => {
    const rawLead = Number(valueOf('reminder.default_lead_minutes') ?? 360);
    const lead = Number.isInteger(rawLead) ? rawLead : 360;
    const suppress = Boolean(valueOf('suppress_reminders_outside_hours'));

    const config = toWorkingHoursConfig({
      start: String(valueOf('working_hours.start') ?? '09:00'),
      end: String(valueOf('working_hours.end') ?? '18:00'),
      workingDays: valueOf('working_days'),
      holidays: [],
    });

    // A fixed example rather than "now", so the sentence does not change while
    // somebody is reading it.
    return previewReminder(fromISTInput('2026-09-14T18:00'), lead, {
      suppressOutsideHours: suppress,
      workingHours: config,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, rows]);

  return (
    <div className="space-y-5">
      <div className="bg-muted/40 rounded-lg border p-4">
        <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
          With these values
        </p>
        <p className="mt-1 text-sm">{preview.sentence}</p>
      </div>

      {SETTING_GROUPS.map((group) => (
        <Section
          key={group.id}
          group={group}
          rows={rows.filter((row) => row.group === group.id)}
          valueOf={valueOf}
          set={set}
          errors={errors}
        />
      ))}

      <div className="bg-background/95 sticky bottom-0 flex flex-wrap items-center gap-3 border-t py-3 backdrop-blur">
        <Button
          onClick={save}
          disabled={
            !dirty ||
            saving ||
            !Number.isInteger(Number(valueOf('reminder.default_lead_minutes') ?? 360))
          }
        >
          {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
          Save changes
        </Button>

        {dirty ? (
          <Button
            variant="ghost"
            onClick={() => {
              setDraft({});
              setErrors({});
            }}
            disabled={saving}
          >
            Discard
          </Button>
        ) : null}

        <p className="text-muted-foreground text-xs">
          {dirty
            ? `${Object.keys(draft).length} unsaved change${Object.keys(draft).length > 1 ? 's' : ''}.`
            : 'Everything is saved.'}
        </p>
      </div>
    </div>
  );
}

function Section({
  group,
  rows,
  valueOf,
  set,
  errors,
}: {
  group: { id: SettingGroup; title: string; blurb: string };
  rows: SettingView[];
  valueOf: (key: string) => unknown;
  set: (key: string, value: unknown) => void;
  errors: Record<string, string[]>;
}) {
  if (rows.length === 0) return null;

  return (
    <section className="bg-card rounded-lg border" aria-labelledby={`group-${group.id}`}>
      <header className="border-b px-4 py-3">
        <h2 id={`group-${group.id}`} className="text-sm font-semibold">
          {group.title}
        </h2>
        <p className="text-muted-foreground mt-0.5 text-xs">{group.blurb}</p>
      </header>

      <div className="divide-y">
        {rows.map((row) => (
          <Field
            key={row.key}
            row={row}
            value={valueOf(row.key)}
            onChange={(value) => set(row.key, value)}
            problems={errors[row.key]}
          />
        ))}
      </div>

      {group.id === 'notifications' ? <TestEmail /> : null}
    </section>
  );
}

function Field({
  row,
  value,
  onChange,
  problems,
}: {
  row: SettingView;
  value: unknown;
  onChange: (value: unknown) => void;
  problems?: string[];
}) {
  const id = `setting-${row.key}`;

  if (row.key === 'reminder.default_lead_minutes') {
    const minutes = typeof value === 'number' && Number.isFinite(value) ? value : 360;

    return (
      <div className="space-y-2 px-4 py-3">
        <Label htmlFor={id} className="text-sm font-medium">
          {row.label}
        </Label>
        <p className="text-muted-foreground text-xs">{row.help}</p>
        {row.caution ? (
          <p className="text-state-problem flex items-start gap-1.5 text-xs">
            <AlertTriangle className="mt-px size-3.5 shrink-0" />
            {row.caution}
          </p>
        ) : null}
        <ReminderLeadField
          id={id}
          minutes={minutes}
          maxMinutes={SETTINGS_LEAD_MAX_MINUTES}
          deadline={fromISTInput('2026-09-14T18:00')}
          invalid={Boolean(problems)}
          hideLabel
          onMinutes={onChange}
        />
        {problems?.map((problem) => (
          <p key={problem} className="text-state-overdue text-xs font-medium">
            {problem}
          </p>
        ))}
      </div>
    );
  }

  return (
    <div className="grid gap-2 px-4 py-3 sm:grid-cols-[1fr_16rem] sm:items-start sm:gap-4">
      <div>
        <Label htmlFor={id} className="text-sm font-medium">
          {row.label}
        </Label>
        <p className="text-muted-foreground mt-0.5 text-xs">{row.help}</p>

        {row.caution ? (
          <p className="text-state-problem mt-1 flex items-start gap-1.5 text-xs">
            <AlertTriangle className="mt-px size-3.5 shrink-0" />
            {row.caution}
          </p>
        ) : null}

        {problems?.map((problem) => (
          <p key={problem} className="text-state-overdue mt-1 text-xs font-medium">
            {problem}
          </p>
        ))}
      </div>

      <Control id={id} row={row} value={value} onChange={onChange} invalid={Boolean(problems)} />
    </div>
  );
}

function Control({
  id,
  row,
  value,
  onChange,
  invalid,
}: {
  id: string;
  row: SettingView;
  value: unknown;
  onChange: (value: unknown) => void;
  invalid: boolean;
}) {
  const ring = invalid ? 'border-state-overdue' : undefined;

  if (row.key === 'working_days') {
    const selected = new Set(Array.isArray(value) ? (value as number[]) : []);

    return (
      <div className="flex flex-wrap gap-1">
        {DAYS.map((day) => {
          const on = selected.has(day.value);

          return (
            <Button
              key={day.value}
              type="button"
              size="sm"
              variant={on ? 'secondary' : 'outline'}
              aria-pressed={on}
              className={cn('h-8 w-12 px-0 text-xs', on && 'font-semibold')}
              onClick={() => {
                const next = new Set(selected);
                if (on) next.delete(day.value);
                else next.add(day.value);
                onChange([...next].sort((a, b) => a - b));
              }}
            >
              {day.label}
            </Button>
          );
        })}
      </div>
    );
  }

  if (row.key === 'mail.md_recipients') {
    const list = Array.isArray(value) ? (value as string[]) : [];

    return (
      <Input
        id={id}
        className={ring}
        value={list.join(', ')}
        placeholder="deputy@jaraaglobal.com, accounts@jaraaglobal.com"
        onChange={(event) =>
          onChange(
            event.target.value
              .split(',')
              .map((part) => part.trim())
              .filter(Boolean),
          )
        }
      />
    );
  }

  if (typeof row.value === 'boolean' || row.key === 'suppress_reminders_outside_hours') {
    const on = Boolean(value);

    return (
      <Button
        id={id}
        type="button"
        variant={on ? 'secondary' : 'outline'}
        size="sm"
        role="switch"
        aria-checked={on}
        className="w-24"
        onClick={() => onChange(!on)}
      >
        {on ? 'On' : 'Off'}
      </Button>
    );
  }

  if (row.writeOnly) {
    return (
      <Input
        id={id}
        type="password"
        className={ring}
        placeholder={row.isSet ? 'Set — type to replace' : 'Not set'}
        autoComplete="new-password"
        onChange={(event) => onChange(event.target.value)}
      />
    );
  }

  if (typeof row.value === 'number') {
    return (
      <Input
        id={id}
        type="number"
        className={cn('tabular', ring)}
        value={String(value ?? '')}
        onChange={(event) => onChange(event.target.value === '' ? '' : Number(event.target.value))}
      />
    );
  }

  const isTime = row.key.endsWith('.time') || row.key.startsWith('working_hours.');

  return (
    <Input
      id={id}
      type={isTime ? 'time' : 'text'}
      className={cn(isTime && 'tabular', ring)}
      value={String(value ?? '')}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

/** "Send test email" (build spec M9.2). */
function TestEmail() {
  const [to, setTo] = useState('');
  const [sending, setSending] = useState(false);

  async function send() {
    setSending(true);

    try {
      const result = await apiFetch<{ sent: boolean; error?: string; at: string }>(
        '/api/settings/test-email',
        { method: 'POST', body: JSON.stringify({ to }) },
      );

      if (result.sent) toast.success(`Sent to ${to} at ${result.at} IST.`);
      // The endpoint returns the failure rather than throwing it: "the host
      // refused the connection" is the answer to "is mail working?".
      else toast.error(result.error ?? 'The message was not accepted.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not send.');
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="bg-muted/30 flex flex-wrap items-end gap-2 border-t px-4 py-3">
      <div className="min-w-56 flex-1">
        <Label htmlFor="test-email" className="text-sm font-medium">
          Send a test email
        </Label>
        <p className="text-muted-foreground mt-0.5 mb-1.5 text-xs">
          Find out that mail is misconfigured now, not the next time a deadline is missed.
        </p>
        <Input
          id="test-email"
          type="email"
          value={to}
          placeholder="you@jaraaglobal.com"
          onChange={(event) => setTo(event.target.value)}
        />
      </div>

      <Button variant="outline" onClick={send} disabled={!to.includes('@') || sending}>
        {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
        Send
      </Button>
    </div>
  );
}
