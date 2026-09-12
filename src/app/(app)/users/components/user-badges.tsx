import type { Role } from '@prisma/client';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

export const ROLE_LABELS: Record<Role, string> = {
  MD: 'Managing Director',
  DEPUTY_MD: 'Deputy MD',
  ADMIN: 'Administrator',
  MEMBER: 'Member',
};

export function RoleBadge({ role }: { role: Role }) {
  return (
    <Badge variant={role === 'MEMBER' ? 'outline' : 'secondary'} className="whitespace-nowrap">
      {ROLE_LABELS[role]}
    </Badge>
  );
}

/**
 * Status at a glance. A locked account reads differently from a deactivated one
 * — the first resolves itself in fifteen minutes, the second needs a decision.
 */
export function StatusBadge({
  isActive,
  lockedUntil,
  mustChangePassword,
}: {
  isActive: boolean;
  lockedUntil: string | null;
  mustChangePassword: boolean;
}) {
  if (!isActive) {
    return (
      <Badge variant="outline" className="text-muted-foreground">
        Deactivated
      </Badge>
    );
  }

  const locked = lockedUntil !== null && new Date(lockedUntil) > new Date();
  if (locked) {
    return <Badge className="bg-state-overdue hover:bg-state-overdue text-white">Locked</Badge>;
  }

  if (mustChangePassword) {
    return (
      <Badge className={cn('bg-state-problem text-white', 'hover:bg-state-problem')}>
        Password pending
      </Badge>
    );
  }

  return <Badge className="bg-state-complete hover:bg-state-complete text-white">Active</Badge>;
}
