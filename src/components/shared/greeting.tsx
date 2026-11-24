'use client';

import { useLanguage } from '@/lib/i18n/provider';
import { formatIST } from '@/lib/utils/time';

/**
 * The first name to greet someone by: "Arun Kumar Pandian" → "Arun",
 * "Kalpana N" → "Kalpana". Bracketed suffixes such as "(Quality)" are dropped.
 */
export function firstName(name: string): string {
  const cleaned = name.replace(/[([{].*?[)\]}]/g, ' ').trim();
  return cleaned.split(/\s+/)[0] || name.trim();
}

/** Morning, afternoon or evening on the factory clock (IST), not the device's. */
function greetingFor(now: Date): string {
  const hour = Number(formatIST(now, 'H'));
  if (hour >= 5 && hour < 12) return 'Good morning, {{name}}';
  if (hour >= 12 && hour < 17) return 'Good afternoon, {{name}}';
  return 'Good evening, {{name}}';
}

/** "Good morning, Arun" — the signed-in person's name at the top of their home screen. */
export function Greeting({ name }: { name: string }) {
  const { t } = useLanguage();
  return (
    // The hour can tip over between the server render and hydration.
    <span suppressHydrationWarning>{t(greetingFor(new Date()), { name: firstName(name) })}</span>
  );
}
