import type { Role } from '@prisma/client';

import { SignOutButton } from '@/components/shared/sign-out-button';
import { Badge } from '@/components/ui/badge';

const ROLE_LABELS: Record<Role, string> = {
  MD: 'Managing Director',
  DEPUTY_MD: 'Deputy MD',
  ADMIN: 'Administrator',
  MEMBER: 'Member',
};

/**
 * Minimal top bar for M1 — identity and sign-out. Navigation arrives with the
 * screens it would link to, from M3 onwards.
 */
export function AppHeader({ name, email, role }: { name: string; email: string; role: Role }) {
  return (
    <header className="bg-card sticky top-0 z-10 border-b">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <div className="flex items-center gap-3">
          <span className="font-semibold tracking-tight">JTAS</span>
          <Badge variant="secondary" className="hidden sm:inline-flex">
            {ROLE_LABELS[role]}
          </Badge>
        </div>

        <div className="flex items-center gap-3">
          <div className="hidden text-right sm:block">
            <p className="text-sm leading-tight font-medium">{name}</p>
            <p className="text-muted-foreground text-xs leading-tight">{email}</p>
          </div>
          <SignOutButton />
        </div>
      </div>
    </header>
  );
}
