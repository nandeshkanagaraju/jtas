'use client';

import { ArrowUpRight, Search } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { NAV_ICONS, type NavItem } from '@/components/shared/main-nav';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';

/** Navigation stays scoped to the links the server grants this account. */
export function QuickNavigation({
  items,
  mobile = false,
  onNavigate,
}: {
  items: NavItem[];
  mobile?: boolean;
  onNavigate?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen((current) => !current);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const matches = items.filter((item) => item.label.toLowerCase().includes(query.toLowerCase()));

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setQuery('');
          setOpen(true);
        }}
        aria-label="Find a page"
        className={
          mobile
            ? 'bg-muted text-foreground inline-flex min-h-11 w-full items-center gap-3 rounded-lg px-4 text-sm'
            : 'text-muted-foreground hover:text-foreground hover:bg-muted hidden min-h-10 items-center gap-2 rounded-lg px-3 text-sm transition-colors sm:inline-flex'
        }
      >
        <Search className="size-4" />
        <span className={mobile ? undefined : 'hidden xl:inline'}>
          {mobile ? 'Find a page' : 'Jump to'}
        </span>
        <kbd className="border-border hidden rounded border px-1.5 py-0.5 font-mono text-[10px] xl:inline">
          ⌘ / Ctrl K
        </kbd>
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="gap-0 p-0 sm:max-w-lg">
          <div className="border-border space-y-2 border-b p-5 pr-12">
            <DialogTitle>Jump to a destination</DialogTitle>
            <DialogDescription>
              Search pages, then tab to a result and press Enter.
            </DialogDescription>
          </div>
          <div className="p-3">
            <Input
              aria-label="Search pages"
              placeholder="Where do you want to go?"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <nav aria-label="Quick navigation" className="mt-2 space-y-1">
              {matches.map((item) => {
                const Icon = NAV_ICONS[item.icon];
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => {
                      setOpen(false);
                      onNavigate?.();
                    }}
                    className="hover:bg-muted flex min-h-12 items-center gap-3 rounded-lg px-3"
                  >
                    <Icon className="text-muted-foreground size-4" />
                    <span className="flex-1">{item.label}</span>
                    <ArrowUpRight className="text-muted-foreground size-4" />
                  </Link>
                );
              })}
              {matches.length === 0 ? (
                <p className="text-muted-foreground px-3 py-8 text-center">
                  No page matches “{query}”. Try another name.
                </p>
              ) : null}
            </nav>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
