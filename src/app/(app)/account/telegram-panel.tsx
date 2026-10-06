'use client';

import { useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { apiFetch, apiPost } from '@/lib/api/client';

/**
 * Link or forget this person's Telegram. The code is shown once; the chat id
 * never is. Email keeps arriving either way.
 */
export function TelegramPanel({
  linked,
  botUsername,
}: {
  linked: boolean;
  botUsername: string | null;
}) {
  const [isLinked, setLinked] = useState(linked);
  const [code, setCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function issue() {
    setBusy(true);
    try {
      const issued = await apiPost<{ code: string; botUsername: string | null }>(
        '/api/account/telegram',
        {},
      );
      setCode(issued.code);
    } catch {
      toast.error('Could not create a link code. Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function unlink() {
    setBusy(true);
    try {
      await apiFetch('/api/account/telegram', { method: 'DELETE' });
      setLinked(false);
      setCode(null);
      toast.success('Telegram unlinked. Email is unchanged.');
    } catch {
      toast.error('Could not unlink Telegram. Try again.');
    } finally {
      setBusy(false);
    }
  }

  const bot = botUsername ? `@${botUsername}` : 'the JTAS bot';

  return (
    <div className="space-y-4">
      <p className="text-muted-foreground text-sm">
        {isLinked
          ? 'This account is linked. Messages arrive here and by email. Email still arrives if the phone is off.'
          : 'Not linked. Email is how you are reached until you link a chat.'}
      </p>

      {code ? (
        <div className="bg-muted rounded-md px-3 py-3">
          <p className="text-sm">In Telegram, open {bot} and send:</p>
          <p className="mt-2 font-mono text-base font-medium">/start {code}</p>
          <p className="text-muted-foreground mt-2 text-xs">
            The code works once, for 15 minutes. Come back here if it expires.
          </p>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button type="button" className="min-h-11" disabled={busy} onClick={issue}>
          {isLinked ? 'Link a different chat' : 'Get a link code'}
        </Button>
        {isLinked ? (
          <Button
            type="button"
            variant="outline"
            className="min-h-11"
            disabled={busy}
            onClick={unlink}
          >
            Unlink
          </Button>
        ) : null}
      </div>
    </div>
  );
}
