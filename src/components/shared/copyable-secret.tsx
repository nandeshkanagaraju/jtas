'use client';

import { Check, Copy } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';

/**
 * Displays a one-time secret with a copy button.
 *
 * Rendered in monospace with tabular figures because the value will be read
 * aloud or retyped, and `rn` versus `m` matters when it is. The value is never
 * placed in a form field, so it cannot be picked up by a password manager or
 * submitted anywhere by accident.
 */
export function CopyableSecret({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2_000);
    } catch {
      // Clipboard access can be refused (insecure context, denied permission).
      // The value is on screen either way, so this needs no error state.
    }
  }

  return (
    <div className="flex items-center gap-2">
      <code className="bg-muted flex-1 rounded-md border px-3 py-2 font-mono text-base tracking-wider tabular-nums select-all">
        {value}
      </code>
      <Button
        type="button"
        variant="outline"
        size="icon"
        onClick={copy}
        aria-label={copied ? 'Copied' : 'Copy to clipboard'}
      >
        {copied ? <Check className="text-ok size-4" /> : <Copy className="size-4" />}
      </Button>
    </div>
  );
}
