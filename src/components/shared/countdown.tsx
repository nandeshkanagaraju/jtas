'use client';

import { useEffect, useState } from 'react';

import { cn } from '@/lib/utils';
import { deadlineLabel } from '@/lib/utils/relative-time';

const TONE_CLASS = {
  overdue: 'text-late font-medium',
  urgent: 'text-risk font-medium',
  soon: 'text-info',
  normal: 'text-muted-foreground',
} as const;

/**
 * A live "due in" label that re-renders on a timer.
 *
 * Deliberately coarse — it ticks once a minute, not once a second. A member
 * needs to know they have four hours, not four hours and nineteen seconds, and
 * a per-second interval on a list of twenty cards is battery the phone should
 * be spending on something else.
 *
 * The first render matches the server's, so hydration is clean; the timer only
 * starts afterwards.
 */
export function Countdown({ deadline, className }: { deadline: string; className?: string }) {
  const [, setTick] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => setTick((value) => value + 1), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const label = deadlineLabel(new Date(deadline));

  return <span className={cn(TONE_CLASS[label.tone], className)}>{label.text}</span>;
}
