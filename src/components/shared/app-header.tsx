import type { Role } from '@prisma/client';

import { MainNav, type NavItem } from '@/components/shared/main-nav';
import { NotificationBell } from '@/components/shared/notification-bell';
import { SignOutButton } from '@/components/shared/sign-out-button';
import { Badge } from '@/components/ui/badge';

const ROLE_LABELS: Record<Role, string> = {
  MD: 'Managing Director',
  DEPUTY_MD: 'Deputy MD',
  ADMIN: 'Administrator',
  MEMBER: 'Member',
};

/**
 * The top bar: navigation, identity, sign-out.
 *
 * Which links appear follows the role, but that is convenience only — every
 * destination re-checks with `can()` and answers 403 on its own
 * (architecture rule 3).
 */
export function AppHeader({
  name,
  email,
  role,
  nav,
  unreadNotifications,
}: {
  name: string;
  email: string;
  role: Role;
  nav: NavItem[];
  unreadNotifications: number;
}) {
  return (
    <header className="bg-card sticky top-0 z-10 border-b">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <span className="shrink-0 font-semibold tracking-tight">JTAS</span>
          <MainNav items={nav} />
        </div>

        <div className="flex items-center gap-3">
          <div className="hidden text-right lg:block">
            <p className="text-sm leading-tight font-medium">{name}</p>
            <p className="text-muted-foreground text-xs leading-tight">{email}</p>
          </div>
          <Badge variant="secondary" className="hidden shrink-0 xl:inline-flex">
            {ROLE_LABELS[role]}
          </Badge>
          <NotificationBell initialUnread={unreadNotifications} />
          <SignOutButton />
        </div>
      </div>
    </header>
  );
}
