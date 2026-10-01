import type { Role } from '@prisma/client';

import { Badge } from '@/components/ui/badge';

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
 *
 * Active is the ordinary case and stays quiet: in a list where every row is a
 * working account, a column of saturated green says nothing. Colour is kept
 * for the three states that need somebody to do something.
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
    return <Badge variant="neutral">Deactivated</Badge>;
  }

  const locked = lockedUntil !== null && new Date(lockedUntil) > new Date();
  if (locked) {
    return <Badge variant="late">Locked</Badge>;
  }

  if (mustChangePassword) {
    return <Badge variant="risk">Password pending</Badge>;
  }

  return <Badge variant="neutral">Active</Badge>;
}
