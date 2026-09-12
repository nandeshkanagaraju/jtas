'use client';

import { LogOut } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { apiPost } from '@/lib/api/client';

export function SignOutButton() {
  const [busy, setBusy] = useState(false);

  async function signOut() {
    setBusy(true);
    try {
      await apiPost('/api/auth/logout', {});
    } catch {
      // Logout is best-effort server-side; either way the session is over as
      // far as this browser is concerned.
    } finally {
      window.location.assign('/login');
    }
  }

  return (
    <Button variant="ghost" size="sm" onClick={signOut} disabled={busy}>
      <LogOut className="size-4" />
      <span className="hidden sm:inline">Sign out</span>
    </Button>
  );
}
