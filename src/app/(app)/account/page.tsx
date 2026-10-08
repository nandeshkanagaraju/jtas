import type { Metadata } from 'next';

import { PageHeader } from '@/components/shared/page-header';
import { Panel } from '@/components/shared/panel';
import { ThemeToggle } from '@/components/shared/theme';
import { requireActiveSession } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';

import { TelegramPanel } from './telegram-panel';

export const metadata: Metadata = { title: 'Your account' };
export const dynamic = 'force-dynamic';

/**
 * The signed-in person. Telegram is linked here, by them, and nowhere else.
 */
export default async function AccountPage() {
  const session = await requireActiveSession();
  const user = await prisma.user.findUnique({
    where: { id: session.id },
    select: { telegramChatId: true },
  });

  const botUsername = process.env.TELEGRAM_BOT_USERNAME?.replace(/^@/, '') || null;

  return (
    <div className="mx-auto max-w-xl space-y-5">
      <PageHeader eyebrow={session.email} title={session.name} lead={roleLine(session.role)} />

      <Panel
        title="Appearance"
        description="Day for a lit office, night for a dim workshop. Auto follows the device."
      >
        <ThemeToggle />
      </Panel>

      <Panel title="Telegram" description="Extra messages on your phone. Email is not turned off.">
        <p className="text-muted-foreground mb-4 max-w-prose text-sm">
          A linked chat is weaker than being signed in: anyone holding that phone can press the
          buttons, and the audit log records that the action came from Telegram.
        </p>
        <TelegramPanel linked={Boolean(user?.telegramChatId)} botUsername={botUsername} />
      </Panel>
    </div>
  );
}

const ROLE_LINES: Record<string, string> = {
  MD: 'Managing Director — every job, every deadline, every open problem.',
  DEPUTY_MD: 'Deputy MD — you act on behalf of the Managing Director, and the record says so.',
  ADMIN: 'Administrator — accounts and settings, not the work itself.',
  MEMBER: 'Department member — the tasks assigned to you.',
};

function roleLine(role: string): string {
  return ROLE_LINES[role] ?? role;
}
