/**
 * Status colour, decided once.
 *
 * Every badge, dot and count in the app resolves its colour through here, so
 * "late" is the same red on the dashboard, the jobs list, a job header and a
 * traveller card. Adding a state means adding a row to one table rather than
 * hunting for the six places that style it.
 *
 * A tone carries four presentations:
 *   - `text`  the word on the canvas, no fill
 *   - `chip`  a tinted pill with a hairline, for a status badge
 *   - `dot`   a 6px square used as a leading marker in dense rows
 *   - `bar`   a solid fill, for progress bars and chart series
 */

export type Tone = 'late' | 'risk' | 'ok' | 'info' | 'neutral';

interface ToneStyles {
  text: string;
  chip: string;
  dot: string;
  bar: string;
}

const TONES: Record<Tone, ToneStyles> = {
  late: {
    text: 'text-late',
    chip: 'bg-late-soft text-late border-late-edge',
    dot: 'bg-late',
    bar: 'bg-late',
  },
  risk: {
    text: 'text-risk',
    chip: 'bg-risk-soft text-risk border-risk-edge',
    dot: 'bg-risk',
    bar: 'bg-risk',
  },
  ok: {
    text: 'text-ok',
    chip: 'bg-ok-soft text-ok border-ok-edge',
    dot: 'bg-ok',
    bar: 'bg-ok',
  },
  info: {
    text: 'text-info',
    chip: 'bg-info-soft text-info border-info-edge',
    dot: 'bg-info',
    bar: 'bg-info',
  },
  neutral: {
    text: 'text-muted-foreground',
    chip: 'bg-muted text-muted-foreground border-border',
    dot: 'bg-muted-foreground/50',
    bar: 'bg-muted-foreground/40',
  },
};

export function tone(name: Tone): ToneStyles {
  return TONES[name];
}

/** The tinted pill itself, ready to drop on a `<span>` or a `<Badge>`. */
export function chipClass(name: Tone): string {
  return TONES[name].chip;
}

export function textClass(name: Tone): string {
  return TONES[name].text;
}

/** Job lifecycle -> tone. The strings are Prisma's `JobStatus`. */
export function jobStatusTone(status: string): Tone {
  switch (status) {
    case 'DELAYED':
      return 'late';
    case 'AT_RISK':
      return 'risk';
    case 'COMPLETED':
      return 'ok';
    case 'IN_PROGRESS':
      return 'info';
    default:
      // DRAFT, ON_HOLD, CANCELLED are states nobody needs to be warned about.
      return 'neutral';
  }
}

/**
 * Problem severity -> tone.
 *
 * MEDIUM and LOW stay neutral on purpose. A queue where every row is coloured
 * tells the reader nothing about which row to open first.
 */
export function severityTone(severity: string): Tone {
  if (severity === 'BLOCKER') return 'late';
  if (severity === 'HIGH') return 'risk';
  return 'neutral';
}
