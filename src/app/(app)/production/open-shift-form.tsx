'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError } from '@/lib/api/client';
import { openReportRequest } from '@/lib/api/production-client';

import { SELECT_CLASS } from './[id]/hourly-tab';

/** Opens (or reopens) the page for a section, shift and date. */
export function OpenShiftForm({
  sections,
  defaultDate,
  defaultShift,
}: {
  sections: Array<'CNC' | 'VMC'>;
  defaultDate: string;
  defaultShift: 'DAY' | 'NIGHT';
}) {
  const router = useRouter();
  const [section, setSection] = useState(sections[0]);
  const [date, setDate] = useState(defaultDate);
  const [shift, setShift] = useState(defaultShift);
  const [busy, setBusy] = useState(false);

  async function open() {
    setBusy(true);
    try {
      const { id } = await openReportRequest({ date, shift, section });
      router.push(`/production/${id}`);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Could not reach the server.');
      setBusy(false);
    }
  }

  return (
    <form
      className="grid gap-3 sm:grid-cols-[repeat(3,minmax(0,1fr))_auto] sm:items-end"
      onSubmit={(event) => {
        event.preventDefault();
        void open();
      }}
    >
      {sections.length > 1 ? (
        <div className="space-y-1.5">
          <Label htmlFor="open-section">Book</Label>
          <select
            id="open-section"
            className={SELECT_CLASS}
            value={section}
            onChange={(event) => setSection(event.target.value as 'CNC' | 'VMC')}
          >
            {sections.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </div>
      ) : (
        <div className="space-y-1.5">
          <Label>Book</Label>
          <p className="border-border bg-muted/40 flex h-10 items-center rounded-md border px-3 font-medium">
            {section}
          </p>
        </div>
      )}
      <div className="space-y-1.5">
        <Label htmlFor="open-date">Date</Label>
        <Input id="open-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="open-shift">Shift</Label>
        <select
          id="open-shift"
          className={SELECT_CLASS}
          value={shift}
          onChange={(event) => setShift(event.target.value as 'DAY' | 'NIGHT')}
        >
          <option value="DAY">Day (from 08:30)</option>
          <option value="NIGHT">Night (from 20:00)</option>
        </select>
      </div>
      <Button type="submit" disabled={busy || !date} className="h-10">
        Open shift
      </Button>
    </form>
  );
}
