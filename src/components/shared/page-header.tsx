import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';

import { cn } from '@/lib/utils';

export function PageHeader({
  eyebrow,
  title,
  lead,
  actions,
  back,
  /**
   * `comfortable` bumps the lead to 16px. For the screens a member reads on a
   * phone with a glove on, where 14px is the floor rather than the target.
   */
  density = 'default',
  className,
  children,
}: {
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  lead?: React.ReactNode;
  /** Right-aligned, and on a phone it wraps under the title rather than shrinking. */
  actions?: React.ReactNode;
  back?: { href: string; label: string };
  density?: 'default' | 'comfortable';
  className?: string;
  /** Tabs or a filter summary that belong to the header rather than the body. */
  children?: React.ReactNode;
}) {
  return (
    <header className={cn('page-heading space-y-6', className)}>
      {back ? (
        <Link
          href={back.href}
          className="text-muted-foreground hover:text-foreground -ml-1 inline-flex min-h-9 items-center gap-1.5 text-sm font-medium transition-colors"
        >
          <ArrowLeft className="size-4" />
          {back.label}
        </Link>
      ) : null}

      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-5">
        <div className="min-w-0">
          {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
          <h1 className={cn('page-title break-words', eyebrow && 'mt-2.5')}>{title}</h1>
          {lead ? (
            <p className={cn('page-lead mt-3', density === 'comfortable' && 'text-base')}>{lead}</p>
          ) : null}
        </div>
        {actions ? (
          <div className="flex max-w-full shrink-0 flex-wrap items-center gap-2">{actions}</div>
        ) : null}
      </div>

      {children}
    </header>
  );
}
