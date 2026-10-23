import { T } from '@/lib/i18n/provider';
import type { Metadata } from 'next';
import Link from 'next/link';
import { WifiOff } from 'lucide-react';
import { SystemState } from '@/components/shared/system-state';
import { Button } from '@/components/ui/button';

export const metadata: Metadata = { title: 'Offline' };

export default function OfflinePage() {
  return (
    <SystemState
      code="Connection unavailable"
      icon={WifiOff}
      title="No connection"
      description="JTAS needs a network to load your tasks and record updates. Move to where there is signal, then reconnect to continue your work."
    >
      <Button asChild>
        <Link href="/">
          <T>{'Reconnect to workspace'}</T>
        </Link>
      </Button>
    </SystemState>
  );
}
