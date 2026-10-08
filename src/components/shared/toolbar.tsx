'use client';

import { Search, X } from 'lucide-react';

import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

/**
 * The row of controls above a list.
 *
 * It is a `<search>` landmark so the filters can be jumped to, and it wraps
 * rather than scrolls: a select that has slid off the right edge of a phone is
 * a filter nobody knows is set.
 */
export function Toolbar({
  children,
  className,
  label = 'Filters',
}: {
  children: React.ReactNode;
  className?: string;
  label?: string;
}) {
  return (
    <search aria-label={label} className={cn('flex flex-wrap items-center gap-2', className)}>
      {children}
    </search>
  );
}

/** The search box. Always the widest thing in the toolbar, always first. */
export function SearchField({
  value,
  onChange,
  placeholder,
  label,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  label: string;
  className?: string;
}) {
  return (
    <div className={cn('relative min-w-56 flex-1', className)}>
      <Search
        aria-hidden
        className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
      />
      <Input
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={label}
        className="pl-9"
      />
      {value ? (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label="Clear search"
          className="text-muted-foreground hover:text-foreground absolute top-1/2 right-1 inline-flex size-7 -translate-y-1/2 items-center justify-center rounded-md transition-colors"
        >
          <X className="size-3.5" />
        </button>
      ) : null}
    </div>
  );
}

export interface FilterOption {
  value: string;
  label: string;
}

/**
 * One dropdown filter, with the "everything" row built in.
 *
 * The trigger carries the chosen label rather than a placeholder, so a set
 * filter is readable without opening it.
 */
export function FilterSelect({
  value,
  onChange,
  options,
  allLabel,
  allValue,
  label,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  options: FilterOption[];
  /** The row that clears this filter, e.g. "All departments". */
  allLabel: string;
  allValue: string;
  label: string;
  className?: string;
}) {
  const set = value !== allValue;

  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger
        aria-label={label}
        className={cn(
          'w-auto min-w-36',
          set && 'border-ring text-foreground font-medium',
          className,
        )}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={allValue}>{allLabel}</SelectItem>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export interface ActiveFilter {
  key: string;
  label: string;
  onClear: () => void;
}

/**
 * What is currently narrowing the list, and how to undo it.
 *
 * Without this, an empty list and a list filtered down to nothing look
 * identical, and the usual outcome is somebody deciding the data is missing.
 */
export function ActiveFilters({
  filters,
  onClearAll,
  resultLabel,
}: {
  filters: ActiveFilter[];
  onClearAll: () => void;
  /** e.g. "7 of 42 jobs". Shown whether or not any filter is set. */
  resultLabel: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span className="text-muted-foreground tabular">{resultLabel}</span>
      {filters.map((filter) => (
        <button
          key={filter.key}
          type="button"
          onClick={filter.onClear}
          className="border-border bg-muted text-foreground hover:bg-accent inline-flex items-center gap-1.5 rounded-md border px-2 py-1 font-medium transition-colors"
        >
          {filter.label}
          <X className="text-muted-foreground size-3" aria-hidden />
          <span className="sr-only">, remove filter</span>
        </button>
      ))}
      {filters.length > 0 ? (
        <button
          type="button"
          onClick={onClearAll}
          className="text-muted-foreground hover:text-foreground underline underline-offset-2 transition-colors"
        >
          Clear all
        </button>
      ) : null}
    </div>
  );
}
