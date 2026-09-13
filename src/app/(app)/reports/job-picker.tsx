'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';
import { Loader2, Search } from 'lucide-react';

import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/**
 * Picks which job the report is about (build spec M8.4).
 *
 * Filters the list already on the page rather than searching the server: the
 * reports view loads the jobs for the selected range, and a keystroke-by-
 * keystroke round trip would be slower than filtering a few hundred rows here.
 * The choice goes into the URL so the report can be linked to.
 */
export interface PickableJob {
  id: string;
  jobCode: string;
  title: string;
  status: string;
  customerName: string | null;
}

export function JobPicker({ jobs, selected }: { jobs: PickableJob[]; selected: string | null }) {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [query, setQuery] = useState('');

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return jobs.slice(0, 60);

    return jobs
      .filter((job) =>
        [job.jobCode, job.title, job.customerName ?? ''].some((field) =>
          field.toLowerCase().includes(needle),
        ),
      )
      .slice(0, 60);
  }, [jobs, query]);

  function select(id: string) {
    const search = new URLSearchParams(params.toString());
    search.set('job', id);
    startTransition(() => router.push(`?${search.toString()}`));
  }

  return (
    <div className="rounded-lg border">
      <div className="border-b p-2">
        <div className="relative">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Job code, title or customer"
            className="h-8 pl-8 text-sm"
            aria-label="Find a job"
          />
        </div>
      </div>

      <ul className="max-h-[28rem] divide-y overflow-y-auto">
        {matches.length === 0 ? (
          <li className="text-muted-foreground px-3 py-8 text-center text-sm">
            No job matches “{query}”.
          </li>
        ) : (
          matches.map((job) => (
            <li key={job.id}>
              <button
                type="button"
                onClick={() => select(job.id)}
                disabled={pending}
                className={cn(
                  'hover:bg-accent/40 flex w-full items-center gap-2 px-3 py-2 text-left transition-colors',
                  job.id === selected && 'bg-accent/60',
                )}
              >
                <div className="min-w-0 flex-1">
                  <p className="tabular text-xs font-medium">{job.jobCode}</p>
                  <p className="text-muted-foreground truncate text-xs">{job.title}</p>
                </div>
                {pending && job.id === selected ? (
                  <Loader2 className="size-3.5 shrink-0 animate-spin" />
                ) : (
                  <span className="text-muted-foreground shrink-0 text-[10px]">{job.status}</span>
                )}
              </button>
            </li>
          ))
        )}
      </ul>

      {jobs.length > matches.length ? (
        <p className="text-muted-foreground border-t px-3 py-2 text-xs">
          Showing {matches.length} of {jobs.length}. Narrow the search to see the rest.
        </p>
      ) : null}
    </div>
  );
}
