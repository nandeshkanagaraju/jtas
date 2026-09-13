import type { Metadata } from 'next';

import { Brand } from '@/components/shared/brand';

export const metadata: Metadata = { title: 'Offline' };

/**
 * Shown by the service worker when a navigation fails with no network.
 *
 * Deliberately honest about what JTAS does *not* do offline: there are no
 * offline writes (build spec M5.6). A member who thought their "completed" tap
 * had been recorded, when it had not, is worse off than one who knows to try
 * again — the whole product rests on the status being true.
 */
export default function OfflinePage() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 px-6 text-center">
      <Brand />

      <div className="space-y-2">
        <h1 className="text-xl font-semibold">No connection</h1>
        <p className="text-muted-foreground mx-auto max-w-sm text-sm">
          JTAS needs a network to load your tasks, and it does not record updates offline — so
          nothing you tap while disconnected is lost or silently accepted.
        </p>
        <p className="text-muted-foreground mx-auto max-w-sm text-sm">
          Move to where there is signal and open the app again.
        </p>
      </div>
    </main>
  );
}
