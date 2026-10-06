'use client';

import { LogOut } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import { cn } from '@/lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { apiPost } from '@/lib/api/client';

const ROLE_LABELS: Record<string, string> = {
  MD: 'Managing Director',
  DEPUTY_MD: 'Deputy MD',
  ADMIN: 'Administrator',
  MEMBER: 'Member',
};

/**
 * Two letters for the avatar.
 *
 * Bracketed suffixes are dropped first: plenty of accounts are named
 * "Meena (Quality)", and the last word's first character would otherwise be an
 * opening parenthesis.
 */
function initials(name: string): string {
  const parts = name
    .replace(/[([{].*?[)\]}]/g, ' ')
    .split(/\s+/)
    .map((part) => part.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter(Boolean);

  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

/**
 * The person at the bottom of the sidebar: name, email, role, sign-out.
 *
 * Users, Audit and Settings are routes in the sidebar, not items in here.
 */
export function AccountMenu({
  name,
  email,
  role,
  collapsed = false,
}: {
  name: string;
  email: string;
  role: string;
  collapsed?: boolean;
}) {
  const [busy, setBusy] = useState(false);

  async function signOut() {
    setBusy(true);
    try {
      await apiPost('/api/auth/logout', {});
    } catch {
      // Logout is best-effort server-side; either way the session is over as
      // far as this browser is concerned.
    } finally {
      window.location.assign('/login');
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Account, ${name}`}
        className={cn(
          'hover:bg-sidebar-hover flex min-h-11 w-full items-center gap-2.5 rounded-md px-1.5 text-left text-sm transition-colors',
          collapsed && 'justify-center px-0',
        )}
      >
        <span className="border-border bg-card text-foreground inline-flex size-8 shrink-0 items-center justify-center rounded-md border text-xs font-semibold">
          {initials(name)}
        </span>
        {collapsed ? null : (
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium">{name}</span>
            <span className="text-muted-foreground block truncate text-xs">
              {ROLE_LABELS[role] ?? role}
            </span>
          </span>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-64">
        <DropdownMenuLabel className="font-normal">
          <span className="block text-sm font-medium">{name}</span>
          <span className="text-muted-foreground block truncate text-xs">{email}</span>
          <span className="text-muted-foreground mt-1 block text-xs">
            {ROLE_LABELS[role] ?? role}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild className="min-h-11">
          <Link href="/account">Your account</Link>
        </DropdownMenuItem>
        <DropdownMenuItem className="min-h-11" disabled={busy} onSelect={signOut}>
          <LogOut />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
