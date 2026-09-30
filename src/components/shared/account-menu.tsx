'use client';

import { LogOut } from 'lucide-react';
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

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
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
          'focus-visible:outline-ring flex min-h-11 w-full items-center gap-2 rounded-md px-1 text-left text-sm focus-visible:outline-2 focus-visible:outline-offset-2',
          collapsed && 'justify-center px-0',
        )}
      >
        <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-full border border-[#313743] bg-[#262b36] text-sm font-medium text-[#f3f5f8]">
          {initials(name)}
        </span>
        {collapsed ? null : <span className="truncate font-medium">{name}</span>}
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
        <DropdownMenuItem className="min-h-11" disabled={busy} onSelect={signOut}>
          <LogOut />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
