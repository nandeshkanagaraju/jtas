'use client';

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
  type ComponentProps,
  type JSX,
  createElement,
} from 'react';
import { useRouter } from 'next/navigation';
import { LOCALE_COOKIE, validLocale, type Locale } from './locale';
import { translate } from './translate';

const LanguageContext = createContext<{ locale: Locale; setLocale: (value: Locale) => void }>({
  locale: 'en',
  setLocale: () => {},
});
export function LanguageProvider({
  initialLocale,
  children,
}: {
  initialLocale: Locale;
  children: ReactNode;
}) {
  const [locale, update] = useState(initialLocale);
  const router = useRouter();
  useEffect(() => {
    const changed = (event: StorageEvent) => {
      if (event.key === LOCALE_COOKIE) {
        update(validLocale(event.newValue));
        router.refresh();
      }
    };
    window.addEventListener('storage', changed);
    return () => window.removeEventListener('storage', changed);
  }, [router]);
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);
  function setLocale(value: Locale) {
    document.cookie = `${LOCALE_COOKIE}=${value}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === 'https:' ? '; Secure' : ''}`;
    try {
      localStorage.setItem(LOCALE_COOKIE, value);
    } catch {
      /* Cookie still persists. */
    }
    update(value);
    router.refresh();
  }
  return (
    <LanguageContext.Provider value={{ locale, setLocale }}>{children}</LanguageContext.Provider>
  );
}
export function useLanguage() {
  const context = useContext(LanguageContext);
  return {
    ...context,
    t: (text: string, values?: Record<string, string | number>) =>
      translate(text, context.locale, values),
  };
}
/** Explicit interface messages only; user-entered content never passes through here. */
export function T({
  children,
  values,
}: {
  children: ReactNode;
  values?: Record<string, string | number>;
}) {
  const { t } = useLanguage();
  return typeof children === 'string' ? t(children, values) : children;
}

/** Native text attributes use the same locale as the visible interface. */
export function LocalizedElement<K extends keyof JSX.IntrinsicElements>({
  as,
  ...props
}: { as: K } & ComponentProps<K>) {
  const { t } = useLanguage();
  const output = { ...props } as Record<string, unknown>;
  for (const key of ['aria-label', 'title', 'placeholder', 'alt']) {
    if (typeof output[key] === 'string') output[key] = t(output[key]);
  }
  return createElement(as, output);
}

export function LanguageSelector({ compact = false }: { compact?: boolean }) {
  const { locale, setLocale, t } = useLanguage();
  return (
    <label
      className={`inline-flex min-h-11 min-w-0 items-center gap-2 text-sm ${compact ? 'max-w-32' : ''}`}
    >
      <span className={compact ? 'sr-only' : 'text-muted-foreground'}>{t('Language')}</span>
      <select
        aria-label={t('Language')}
        value={locale}
        onChange={(event) => setLocale(validLocale(event.target.value))}
        className="border-border bg-card text-foreground min-h-11 min-w-0 rounded-md border px-2 text-sm"
      >
        <option value="en" lang="en">
          English
        </option>
        <option value="ta" lang="ta">
          தமிழ்
        </option>
        <option value="hi" lang="hi">
          हिन्दी
        </option>
      </select>
    </label>
  );
}
