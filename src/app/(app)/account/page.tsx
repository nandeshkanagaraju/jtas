import { T } from '@/lib/i18n/provider';
import { LanguageSelector } from '@/lib/i18n/provider';
import { PushSettings } from '@/components/shared/push-settings';
import { Fingerprint } from 'lucide-react';
import type { Metadata } from 'next';

import { PageHeader } from '@/components/shared/page-header';
import { AppInstallPanel } from '@/components/shared/app-install';
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
    <div className="w-full space-y-5">
      <div className="bg-primary/10 text-action flex size-16 items-center justify-center rounded-2xl">
        <Fingerprint className="size-8" strokeWidth={1.5} aria-hidden />
      </div>
      <PageHeader
        eyebrow={session.email}
        title={session.name}
        lead={<T>{roleLine(session.role)}</T>}
      />

      <div className="workspace-columns">
        <AppInstallPanel />
        <Panel
          title={<T>{'Language'}</T>}
          description={<T>{'Choose the language for this browser or installed app.'}</T>}
        >
          <LanguageSelector />
        </Panel>
        <Panel title={<T>{'Push notifications'}</T>}>
          <PushSettings />
        </Panel>
        <Panel
          title={<T>{'Appearance'}</T>}
          description={
            <T>{'Day for a lit office, night for a dim workshop. Auto follows the device.'}</T>
          }
        >
          <ThemeToggle />
        </Panel>

        <Panel
          title={<T>{'Telegram'}</T>}
          description={<T>{'Extra messages on your phone. Email is not turned off.'}</T>}
        >
          <p className="text-muted-foreground mb-4 max-w-prose text-sm">
            <T>
              {
                'A linked chat is weaker than being signed in: anyone holding that phone can press the buttons, and the audit log records that the action came from Telegram. '
              }
            </T>
          </p>
          <TelegramPanel linked={Boolean(user?.telegramChatId)} botUsername={botUsername} />
        </Panel>
      </div>
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
