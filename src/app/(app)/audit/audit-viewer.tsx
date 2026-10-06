'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState, useTransition } from 'react';
import { ChevronDown, Download, Loader2, X } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { apiFetch } from '@/lib/api/client';
import type { AuditEntry, AuditPage } from '@/lib/services/audit-query';
import { cn } from '@/lib/utils';
import { formatIST } from '@/lib/utils/time';

export interface AuditFacetData {
  actions: string[];
  entityTypes: string[];
  actors: Array<{ id: string; name: string; email: string }>;
}

interface Filters {
  actorId: string;
  entityType: string;
  entityId: string;
  action: string;
  from: string;
  to: string;
}

const EMPTY: Filters = { actorId: '', entityType: '', entityId: '', action: '', from: '', to: '' };

/** Actions whose name alone reads as trouble. */
const ALARMING = /FAILED|REJECTED|ESCALATED|CANCELLED|DEACTIVATED|OVERDUE/;

export function AuditViewer({
  initial,
  facets,
  filters: initialFilters,
  traceMode = false,
}: {
  initial: AuditPage;
  facets: AuditFacetData;
  filters: Partial<Filters>;
  /** One job's whole story: already complete, so the filters would only narrow it. */
  traceMode?: boolean;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  const [filters, setFilters] = useState<Filters>({ ...EMPTY, ...initialFilters });
  const [entries, setEntries] = useState(initial.data);
  const [cursor, setCursor] = useState(initial.nextCursor);
  const [loadingMore, setLoadingMore] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  const query = (next: Filters) => {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(next)) if (value) search.set(key, value);
    return search.toString();
  };

  function apply(next: Filters) {
    setFilters(next);
    // The filter lives in the URL, so a filtered view can be sent to somebody.
    startTransition(() => router.push(`/audit?${query(next)}`));
  }

  async function loadMore() {
    if (!cursor) return;
    setLoadingMore(true);

    try {
      const search = new URLSearchParams(query(filters));
      search.set('cursor', cursor);
      search.set('facets', 'false');

      const page = await apiFetch<AuditPage>(`/api/audit?${search.toString()}`);
      setEntries((current) => [...current, ...page.data]);
      setCursor(page.nextCursor);
    } finally {
      setLoadingMore(false);
    }
  }

  const active = Object.values(filters).filter(Boolean).length;
  const exportHref = `/api/audit/export?${params.toString()}`;

  return (
    <div className="space-y-4">
      {traceMode ? null : (
        <section className="bg-card rounded-lg border">
          <header className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
            <h2 className="text-sm font-semibold">Filters{active > 0 ? ` (${active})` : ''}</h2>

            <div className="flex items-center gap-2">
              {active > 0 ? (
                <Button variant="ghost" size="sm" onClick={() => apply(EMPTY)}>
                  <X className="size-3.5" />
                  Clear
                </Button>
              ) : null}

              <Button asChild variant="outline" size="sm">
                <a href={exportHref} download>
                  <Download className="size-3.5" />
                  Export CSV
                </a>
              </Button>
            </div>
          </header>

          <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
            <Select
              label="Who"
              value={filters.actorId}
              onChange={(actorId) => apply({ ...filters, actorId })}
              options={[
                { value: '', label: 'Anyone' },
                ...facets.actors.map((actor) => ({ value: actor.id, label: actor.name })),
              ]}
            />
            <Select
              label="Action"
              value={filters.action}
              onChange={(action) => apply({ ...filters, action })}
              options={[
                { value: '', label: 'Any action' },
                ...facets.actions.map((value) => ({ value, label: value.replaceAll('_', ' ') })),
              ]}
            />
            <Select
              label="Entity type"
              value={filters.entityType}
              onChange={(entityType) => apply({ ...filters, entityType })}
              options={[
                { value: '', label: 'Any type' },
                ...facets.entityTypes.map((value) => ({ value, label: value })),
              ]}
            />

            <Field
              label="Entity id"
              value={filters.entityId}
              placeholder="A job, subtask or problem id"
              onCommit={(entityId) => apply({ ...filters, entityId })}
            />
            <Field
              label="From"
              type="date"
              value={filters.from}
              onCommit={(from) => apply({ ...filters, from })}
            />
            <Field
              label="To"
              type="date"
              value={filters.to}
              onCommit={(to) => apply({ ...filters, to })}
            />
          </div>
        </section>
      )}

      <div className="flex items-center gap-2">
        <p className="text-muted-foreground text-sm">
          {initial.total === 0
            ? 'Nothing matches.'
            : traceMode
              ? `${initial.total} actions.`
              : `Showing ${entries.length} of ${initial.total}.`}
        </p>
        {pending ? <Loader2 className="text-muted-foreground size-3.5 animate-spin" /> : null}
      </div>

      <ol className="border-border bg-card divide-border divide-y overflow-hidden rounded-lg border">
        {entries.map((entry) => (
          <Row
            key={entry.id}
            entry={entry}
            expanded={open === entry.id}
            onToggle={() => setOpen(open === entry.id ? null : entry.id)}
          />
        ))}
      </ol>

      {cursor ? (
        <Button variant="outline" onClick={loadMore} disabled={loadingMore} className="w-full">
          {loadingMore ? <Loader2 className="size-4 animate-spin" /> : null}
          Load more
        </Button>
      ) : entries.length > 0 ? (
        <p className="text-muted-foreground py-2 text-center text-xs">That is the whole log.</p>
      ) : null}
    </div>
  );
}

function Row({
  entry,
  expanded,
  onToggle,
}: {
  entry: AuditEntry;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="hover:bg-accent/40 flex w-full items-start gap-3 px-4 py-2.5 text-left transition-colors"
      >
        <span className="text-muted-foreground tabular w-36 shrink-0 text-xs">
          {formatIST(new Date(entry.createdAt))}
        </span>

        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <Badge
              variant="outline"
              className={cn(
                'text-xs',
                ALARMING.test(entry.action) && 'border-state-overdue/30 text-state-overdue',
              )}
            >
              {entry.action.replaceAll('_', ' ')}
            </Badge>
            <span className="text-muted-foreground text-xs">
              {entry.entityType} · <span className="tabular">{entry.entityId}</span>
            </span>
          </span>

          <span className="mt-1 block text-sm">
            {/* "system" rather than a blank: a sweeper-written row has no human
                actor, and an empty cell reads as missing data. */}
            {entry.actor?.name ?? 'system'}
            {entry.onBehalfOf ? (
              <span className="text-muted-foreground"> on behalf of {entry.onBehalfOf}</span>
            ) : null}
            {entry.diff.length > 0 ? (
              <span className="text-muted-foreground">
                {' · '}
                {entry.diff
                  .slice(0, 2)
                  .map((change) => `${change.field} ${change.before} → ${change.after}`)
                  .join(', ')}
                {entry.diff.length > 2 ? ` +${entry.diff.length - 2} more` : ''}
              </span>
            ) : null}
          </span>
        </span>

        <ChevronDown
          className={cn(
            'text-muted-foreground mt-1 size-4 shrink-0 transition-transform',
            expanded && 'rotate-180',
          )}
        />
      </button>

      {expanded ? (
        <div className="space-y-3 border-t px-4 py-3">
          {entry.diff.length > 0 ? (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-muted-foreground text-left text-xs">
                  <th className="py-1 font-medium">Field</th>
                  <th className="py-1 font-medium">Before</th>
                  <th className="py-1 font-medium">After</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {entry.diff.map((change) => (
                  <tr key={change.field}>
                    <td className="py-1.5 pr-3 font-medium">{change.field}</td>
                    <td className="text-muted-foreground py-1.5 pr-3 line-through">
                      {change.before}
                    </td>
                    <td className="py-1.5 font-medium">{change.after}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-muted-foreground text-sm">
              No field changes recorded — the action is the whole event.
            </p>
          )}

          <dl className="text-muted-foreground grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
            <div>
              <dt className="inline font-medium">Actor: </dt>
              <dd className="inline">{entry.actor?.email ?? 'system (the scheduler)'}</dd>
            </div>
            <div>
              <dt className="inline font-medium">IP: </dt>
              <dd className="tabular inline">{entry.ipAddress ?? '—'}</dd>
            </div>
            <div>
              <dt className="inline font-medium">Source: </dt>
              <dd className="inline">
                {entry.source === 'TELEGRAM' ? 'Telegram' : 'Signed-in session'}
              </dd>
            </div>
          </dl>
        </div>
      ) : null}
    </li>
  );
}

function Select({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  const id = `audit-${label.toLowerCase().replace(/\s+/g, '-')}`;

  return (
    <div>
      <Label htmlFor={id} className="text-xs">
        {label}
      </Label>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="border-input bg-card mt-1 h-9 w-full rounded-md border px-2 text-sm"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function Field({
  label,
  value,
  type = 'text',
  placeholder,
  onCommit,
}: {
  label: string;
  value: string;
  type?: string;
  placeholder?: string;
  onCommit: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const id = `audit-${label.toLowerCase().replace(/\s+/g, '-')}`;

  return (
    <div>
      <Label htmlFor={id} className="text-xs">
        {label}
      </Label>
      <Input
        id={id}
        type={type}
        value={draft}
        placeholder={placeholder}
        className="mt-1 h-9 text-sm"
        onChange={(event) => setDraft(event.target.value)}
        // Committed on blur or Enter rather than per keystroke: an id is 25
        // characters and a query per character is 25 useless round trips.
        onBlur={() => draft !== value && onCommit(draft)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') onCommit(draft);
        }}
      />
    </div>
  );
}
