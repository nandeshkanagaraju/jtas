import messages from './messages.json';
import type { Locale } from './locale';

export function translate(
  text: string,
  locale: Locale,
  values: Record<string, string | number> = {},
): string {
  const interpolate = (value: string) =>
    value.replace(/\{\{(\w+)\}\}/g, (match, key: string) => String(values[key] ?? match));
  if (locale === 'en') return interpolate(text);
  const key = text.replace(/\s+/g, ' ').trim();
  const entry = (messages as Record<string, string[]>)[key];
  if (!entry) {
    // Relative-time labels come from the shared scheduling helpers. Match only
    // complete known formats, never replace words in user content.
    const duration =
      /^(?:(finished) )?(in )?((?:\d+ (?:minutes?|hours?|days?|weeks?|months?) ?)+)(?: (late|early))?$/.exec(
        key,
      );
    if (duration) {
      const units: Record<string, [string, string]> = {
        minute: ['நிமிடங்கள்', 'मिनट'],
        hour: ['மணி நேரம்', 'घंटे'],
        day: ['நாட்கள்', 'दिन'],
        week: ['வாரங்கள்', 'सप्ताह'],
        month: ['மாதங்கள்', 'महीने'],
      };
      const span = duration[3]
        .trim()
        .replace(
          /(\d+) (minute|hour|day|week|month)s?/g,
          (_, count: string, unit: string) => `${count} ${units[unit][locale === 'ta' ? 0 : 1]}`,
        );
      if (duration[4] === 'late')
        return locale === 'ta'
          ? `${span} தாமதம்${duration[1] ? ' முடிந்தது' : ''}`
          : `${span} देरी${duration[1] ? ' से पूरा हुआ' : ''}`;
      if (duration[4] === 'early')
        return locale === 'ta' ? `${span} முன்னதாக முடிந்தது` : `${span} पहले पूरा हुआ`;
      return duration[2] ? (locale === 'ta' ? `${span} மீதம்` : `${span} में`) : span;
    }
    return interpolate(text);
  }
  const translated = interpolate(entry[locale === 'ta' ? 0 : 1]);
  return `${text.match(/^\s*/)?.[0] ?? ''}${translated}${text.match(/\s*$/)?.[0] ?? ''}`;
}
