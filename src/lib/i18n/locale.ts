export const LOCALE_COOKIE = 'jtas-language';
export type Locale = 'en' | 'ta' | 'hi';
export function validLocale(value: unknown): Locale {
  return value === 'ta' || value === 'hi' ? value : 'en';
}
