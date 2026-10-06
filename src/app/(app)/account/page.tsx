import type { Metadata } from 'next';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Your account</h1>
        <p className="text-muted-foreground mt-0.5 text-sm">{session.email}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Telegram</CardTitle>
          <CardDescription>
            Extra messages on your phone. Email is not turned off. A linked chat is weaker than
            being signed in: anyone holding that phone can press the buttons, and the audit log
            records that the action came from Telegram.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <TelegramPanel linked={Boolean(user?.telegramChatId)} botUsername={botUsername} />
        </CardContent>
      </Card>
    </div>
  );
}
