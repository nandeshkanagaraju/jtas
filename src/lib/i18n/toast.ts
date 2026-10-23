'use client';
import { toast as sonner } from 'sonner';
import { LOCALE_COOKIE, validLocale } from './locale';
import { translate } from './translate';

// Feedback is translated when raised; domain values and API payloads stay intact.
export const toast: typeof sonner = new Proxy(sonner, {
  get(target, key, receiver) {
    const value = Reflect.get(target, key, receiver);
    if (
      typeof value !== 'function' ||
      !['success', 'error', 'warning', 'info', 'message', 'loading'].includes(String(key))
    )
      return value;
    return (message: unknown, ...args: unknown[]) => {
      const locale = validLocale(
        typeof document === 'undefined'
          ? 'en'
          : document.cookie
              .split('; ')
              .find((part) => part.startsWith(`${LOCALE_COOKIE}=`))
              ?.split('=')[1],
      );
      return Reflect.apply(value, target, [
        typeof message === 'string' ? translate(message, locale) : message,
        ...args,
      ]);
    };
  },
});
