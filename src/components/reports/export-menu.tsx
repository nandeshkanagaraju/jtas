import { Download, FileSpreadsheet, FileText } from 'lucide-react';

import { Button } from '@/components/ui/button';

/**
 * Export links (build spec M8.4/M8.5).
 *
 * Plain anchors rather than fetch-and-save: the browser's own download
 * machinery handles the `Content-Disposition` the route already sends, shows
 * real progress on a slow connection, and needs no JavaScript to work at all.
 */
export interface ExportParams {
  from: string;
  to: string;
  departmentId?: string;
  jobId?: string;
  status?: string;
}

function href(type: string, format: string, params: ExportParams): string {
  const search = new URLSearchParams({ type, format, from: params.from, to: params.to });

  if (params.departmentId) search.set('departmentId', params.departmentId);
  if (params.jobId) search.set('jobId', params.jobId);
  if (params.status) search.set('status', params.status);

  return `/api/reports/export?${search.toString()}`;
}

/** The three list exports, for the scorecards view. */
export function ListExports({ params }: { params: ExportParams }) {
  const lists: Array<[string, string]> = [
    ['jobs', 'Jobs'],
    ['subtasks', 'Subtasks'],
    ['problems', 'Problems'],
  ];

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-muted-foreground mr-0.5 flex items-center gap-1 text-xs">
        <Download className="size-3.5" />
        Export
      </span>

      {lists.map(([type, label]) => (
        <Button key={type} asChild size="sm" variant="outline" className="h-7 px-2.5 text-xs">
          <a href={href(type, 'xlsx', params)} download>
            <FileSpreadsheet className="size-3.5" />
            {label}
          </a>
        </Button>
      ))}
    </div>
  );
}

/** Both formats of one job's report. */
export function JobReportExports({ params }: { params: ExportParams }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Button asChild size="sm" variant="outline" className="h-7 px-2.5 text-xs">
        <a href={href('job-report', 'pdf', params)} download>
          <FileText className="size-3.5" />
          PDF
        </a>
      </Button>

      <Button asChild size="sm" variant="outline" className="h-7 px-2.5 text-xs">
        <a href={href('job-report', 'xlsx', params)} download>
          <FileSpreadsheet className="size-3.5" />
          Excel
        </a>
      </Button>
    </div>
  );
}
