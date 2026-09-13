'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Loader2, Plus, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ApiError, apiFetch } from '@/lib/api/client';
import type { HolidayRow } from '@/lib/services/holiday-service';
import { cn } from '@/lib/utils';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** `YYYY-MM-DD` for a UTC-constructed day. */
function key(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * The days of a month laid out Monday-first, padded so the first row lines up.
 *
 * Built from UTC parts rather than a local `Date`: the grid is a calendar of
 * IST days, and constructing them locally would slide the month by one on a
 * machine west of Greenwich.
 */
function monthGrid(year: number, month: number): Array<string | null> {
  const first = new Date(Date.UTC(year, month, 1));
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

  // getUTCDay is 0 = Sunday; the grid starts on Monday.
  const lead = (first.getUTCDay() + 6) % 7;

  return [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => key(year, month, i + 1)),
  ];
}

export function HolidayCalendar({
  initial,
  canManage,
}: {
  initial: HolidayRow[];
  canManage: boolean;
}) {
  const router = useRouter();
  const today = new Date();

  const [year, setYear] = useState(today.getUTCFullYear());
  const [month, setMonth] = useState(today.getUTCMonth());
  const [holidays, setHolidays] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [csv, setCsv] = useState('');

  const byDate = useMemo(() => new Map(holidays.map((row) => [row.date, row])), [holidays]);
  const grid = useMemo(() => monthGrid(year, month), [year, month]);

  async function reload() {
    const result = await apiFetch<{ data: HolidayRow[] }>('/api/holidays');
    setHolidays(result.data);
    router.refresh();
  }

  function step(by: number) {
    const next = new Date(Date.UTC(year, month + by, 1));
    setYear(next.getUTCFullYear());
    setMonth(next.getUTCMonth());
  }

  async function add(dates: Array<{ date: string; name: string }>) {
    setBusy(true);

    try {
      const result = await apiFetch<{ added: HolidayRow[]; alreadyPresent: HolidayRow[] }>(
        '/api/holidays',
        { method: 'POST', body: JSON.stringify({ holidays: dates }) },
      );

      await reload();
      setPending(null);
      setName('');

      const skipped = result.alreadyPresent.length;
      toast.success(
        `${result.added.length} added` + (skipped > 0 ? `, ${skipped} already there.` : '.'),
      );
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Could not add that holiday.');
    } finally {
      setBusy(false);
    }
  }

  async function importCsv() {
    setBusy(true);

    try {
      const result = await apiFetch<{ added: HolidayRow[]; alreadyPresent: HolidayRow[] }>(
        '/api/holidays',
        { method: 'POST', body: JSON.stringify({ csv }) },
      );

      await reload();
      setCsv('');
      toast.success(
        `${result.added.length} added, ${result.alreadyPresent.length} already in the calendar.`,
      );
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Could not read that list.');
    } finally {
      setBusy(false);
    }
  }

  async function remove(row: HolidayRow) {
    setBusy(true);

    try {
      await apiFetch(`/api/holidays/${row.id}`, { method: 'DELETE' });
      await reload();
      toast.success(`${row.name} removed.`);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Could not remove that holiday.');
    } finally {
      setBusy(false);
    }
  }

  const inMonth = holidays
    .filter((row) => row.date.startsWith(`${year}-${String(month + 1).padStart(2, '0')}`))
    .sort((a, b) => a.date.localeCompare(b.date));

  return (
    <div className="space-y-4">
      <section className="rounded-lg border">
        <header className="flex items-center justify-between border-b px-4 py-3">
          <h2 className="text-sm font-semibold">
            {MONTHS[month]} {year}
          </h2>
          <div className="flex gap-1">
            <Button variant="ghost" size="sm" onClick={() => step(-1)} aria-label="Previous month">
              <ChevronLeft className="size-4" />
            </Button>
            <Button variant="ghost" size="sm" onClick={() => step(1)} aria-label="Next month">
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </header>

        <div className="p-3">
          <div className="text-muted-foreground mb-1 grid grid-cols-7 gap-1 text-center text-xs">
            {WEEKDAYS.map((day) => (
              <div key={day}>{day}</div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-1">
            {grid.map((date, index) => {
              if (!date) return <div key={`pad-${index}`} />;

              const holiday = byDate.get(date);
              const day = Number(date.slice(-2));
              const selected = pending === date;

              return (
                <button
                  key={date}
                  type="button"
                  disabled={!canManage || busy}
                  onClick={() => setPending(selected ? null : date)}
                  className={cn(
                    'aspect-square rounded-md border p-1 text-left text-xs transition-colors',
                    holiday
                      ? 'border-state-problem/40 bg-state-problem/10'
                      : 'hover:bg-accent/50 border-transparent',
                    selected && 'ring-ring ring-2',
                    !canManage && 'cursor-default',
                  )}
                  title={holiday?.name}
                >
                  <span className="tabular font-medium">{day}</span>
                  {holiday ? (
                    <span className="text-state-problem mt-0.5 line-clamp-2 block text-[10px] leading-tight">
                      {holiday.name}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>

        {canManage && pending ? (
          <div className="flex flex-wrap items-end gap-2 border-t px-4 py-3">
            <div className="min-w-48 flex-1">
              <Label htmlFor="holiday-name" className="text-sm">
                Name for {pending}
              </Label>
              <Input
                id="holiday-name"
                value={name}
                autoFocus
                placeholder="Diwali, Factory shutdown"
                onChange={(event) => setName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && name.trim().length >= 2) {
                    void add([{ date: pending, name }]);
                  }
                }}
              />
            </div>

            <Button
              onClick={() => add([{ date: pending, name }])}
              disabled={name.trim().length < 2 || busy}
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
              Add
            </Button>
            <Button variant="ghost" onClick={() => setPending(null)}>
              Cancel
            </Button>
          </div>
        ) : null}
      </section>

      <section className="rounded-lg border">
        <header className="border-b px-4 py-3">
          <h2 className="text-sm font-semibold">
            {MONTHS[month]} holidays ({inMonth.length})
          </h2>
        </header>

        {inMonth.length === 0 ? (
          <p className="text-muted-foreground px-4 py-6 text-center text-sm">
            No holidays this month.
            {canManage ? ' Click a day above to add one.' : ''}
          </p>
        ) : (
          <ul className="divide-y">
            {inMonth.map((row) => (
              <li key={row.id} className="flex items-center gap-3 px-4 py-2.5">
                <span className="tabular text-sm font-medium">{row.date}</span>
                <span className="text-sm">{row.name}</span>
                {canManage ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-muted-foreground hover:text-state-overdue ml-auto"
                    onClick={() => remove(row)}
                    disabled={busy}
                    aria-label={`Remove ${row.name}`}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      {canManage ? (
        <section className="rounded-lg border">
          <header className="border-b px-4 py-3">
            <h2 className="text-sm font-semibold">Import the annual list</h2>
            <p className="text-muted-foreground mt-0.5 text-xs">
              One holiday per line, <code className="tabular">2027-01-26,Republic Day</code>. A
              header row and anything after a <code>#</code> are ignored, and a date already in the
              calendar is skipped rather than duplicated.
            </p>
          </header>

          <div className="space-y-2 p-4">
            <Textarea
              value={csv}
              rows={6}
              className="tabular text-sm"
              placeholder={
                '2027-01-26,Republic Day\n2027-08-15,Independence Day\n2027-11-05,Diwali'
              }
              onChange={(event) => setCsv(event.target.value)}
            />

            <Button
              variant="outline"
              onClick={importCsv}
              disabled={csv.trim().length === 0 || busy}
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
              Import
            </Button>
          </div>
        </section>
      ) : null}
    </div>
  );
}
