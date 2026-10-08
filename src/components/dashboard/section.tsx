import { Panel } from '@/components/shared/panel';
import type { Tone } from '@/lib/ui/tone';

/**
 * The dashboard's panel, which is now the app's panel.
 *
 * This shape was invented here and then needed on Jobs, Problems, Settings and
 * every other screen, so it moved to `components/shared/panel`. The two names
 * stay because the dashboard reads better with them: a `Section` with a count,
 * and the one line a list shows when it is `Empty`.
 */
export function Section({
  id,
  title,
  count,
  countTone = 'neutral',
  children,
  footer,
  className,
}: {
  id: string;
  title: string;
  /** Shop-wide total, which is usually larger than the rows shown. */
  count?: number;
  countTone?: Tone;
  children: React.ReactNode;
  footer?: { href: string; label: string };
  className?: string;
}) {
  return (
    <Panel
      id={id}
      title={title}
      count={count}
      countTone={countTone}
      footer={footer}
      className={className}
      flush
    >
      {children}
    </Panel>
  );
}

/** What a list says when there is nothing in it. Never an illustration. */
export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-muted-foreground px-4 py-6 text-sm">{children}</p>;
}
