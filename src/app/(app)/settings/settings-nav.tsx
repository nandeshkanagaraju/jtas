import Link from 'next/link';

import { cn } from '@/lib/utils';

/** The three governance screens, which share a home in the nav. */
const TABS = [
  { id: 'general', href: '/settings', label: 'General' },
  { id: 'holidays', href: '/settings/holidays', label: 'Holiday calendar' },
  { id: 'templates', href: '/settings/templates', label: 'Job templates' },
] as const;

export function SettingsNav({ current }: { current: (typeof TABS)[number]['id'] }) {
  return (
    <nav className="flex gap-1 border-b" aria-label="Settings sections">
      {TABS.map((tab) => (
        <Link
          key={tab.id}
          href={tab.href}
          aria-current={tab.id === current ? 'page' : undefined}
          className={cn(
            '-mb-px border-b-2 px-3 py-2 text-sm transition-colors',
            tab.id === current
              ? 'border-foreground font-semibold'
              : 'text-muted-foreground hover:text-foreground border-transparent',
          )}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
