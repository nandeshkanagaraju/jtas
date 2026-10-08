'use client';

import { Monitor, Moon, Sun } from 'lucide-react';
import { ThemeProvider as NextThemeProvider, useTheme } from 'next-themes';
import { useEffect, useState } from 'react';

import { cn } from '@/lib/utils';

/**
 * Day and night shift.
 *
 * The palette has always had a dark half — every token carries one — but
 * nothing could reach it. Second shift works in a dim workshop where a paper-
 * white screen is the brightest thing in the room, so this is a real setting,
 * defaulting to whatever the device already decided.
 */
export function ThemeProvider({
  children,
  nonce,
}: {
  children: React.ReactNode;
  /** The request's CSP nonce, so the pre-paint script is allowed to run. */
  nonce?: string;
}) {
  return (
    <NextThemeProvider
      nonce={nonce}
      attribute="class"
      defaultTheme="system"
      enableSystem
      storageKey="jtas-theme"
      // The canvas is a flat colour either way; a cross-fade on every surface
      // at once reads as a flicker rather than a transition.
      disableTransitionOnChange
    >
      {children}
    </NextThemeProvider>
  );
}

const CHOICES = [
  { value: 'light', label: 'Day', icon: Sun },
  { value: 'dark', label: 'Night', icon: Moon },
  { value: 'system', label: 'Auto', icon: Monitor },
] as const;

/**
 * A three-way segmented control rather than a toggle, because "follow the
 * device" is a real answer and a toggle cannot express it.
 *
 * Renders a disabled placeholder of the same size until mounted: the chosen
 * theme is only known in the browser, and swapping a wrong highlight for the
 * right one on hydration is worse than waiting one frame.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  return (
    <div
      role="radiogroup"
      aria-label="Colour theme"
      className={cn(
        'border-border bg-card inline-flex items-center gap-0.5 rounded-md border p-0.5',
        className,
      )}
    >
      {CHOICES.map((choice) => {
        const Icon = choice.icon;
        const active = mounted && theme === choice.value;
        return (
          <button
            key={choice.value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={choice.label}
            title={choice.label}
            onClick={() => setTheme(choice.value)}
            className={cn(
              'inline-flex size-7 items-center justify-center rounded-[5px] transition-colors',
              active
                ? 'bg-secondary text-foreground'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted',
            )}
          >
            <Icon className="size-4" strokeWidth={1.75} aria-hidden />
          </button>
        );
      })}
    </div>
  );
}
