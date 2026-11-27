'use client';

import { Download, Loader2 } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { downloadFile } from '@/lib/api/download';
import { T } from '@/lib/i18n/provider';
import { toast } from '@/lib/i18n/toast';
import { istDateKey } from '@/lib/utils/time';

/** QA's hourly report for one day, filled in, as Excel or PDF. */
export function HourlyReportDownload({ subtaskId }: { subtaskId: string }) {
  const today = istDateKey(new Date());
  const [date, setDate] = useState(today);
  const [busy, setBusy] = useState<'xlsx' | 'pdf' | null>(null);

  async function download(format: 'xlsx' | 'pdf') {
    setBusy(format);
    try {
      await downloadFile(`/api/subtasks/${subtaskId}/hourly-report?date=${date}&format=${format}`);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Could not download the report.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="border-border mt-4 flex flex-wrap items-end gap-3 border-t pt-4">
      <div className="space-y-1.5">
        <Label htmlFor={`hourly-date-${subtaskId}`}>
          <T>{'Report for'}</T>
        </Label>
        <Input
          id={`hourly-date-${subtaskId}`}
          type="date"
          max={today}
          value={date}
          onChange={(event) => event.target.value && setDate(event.target.value)}
        />
      </div>
      {(['pdf', 'xlsx'] as const).map((format) => (
        <Button
          key={format}
          variant="outline"
          disabled={busy !== null}
          onClick={() => void download(format)}
        >
          {busy === format ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Download className="size-4" />
          )}
          <T>{format === 'pdf' ? 'Download PDF' : 'Download Excel'}</T>
        </Button>
      ))}
    </div>
  );
}
