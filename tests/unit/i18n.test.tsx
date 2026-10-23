// @vitest-environment jsdom
import { fireEvent, render, screen, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LanguageProvider, LanguageSelector, T } from '@/lib/i18n/provider';
import { translate } from '@/lib/i18n/translate';
import { validLocale } from '@/lib/i18n/locale';
import messages from '@/lib/i18n/messages.json';
const refresh = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));
afterEach(cleanup);

describe('interface language', () => {
  it('falls back to English for unknown locales and messages', () => {
    expect(validLocale('xx')).toBe('en');
    expect(translate('Custom CNC part title', 'ta')).toBe('Custom CNC part title');
  });
  it('localizes counts and relative deadlines', () => {
    expect(translate('{{count}} unread notifications', 'hi', { count: 3 })).toBe('3 अपठित सूचनाएँ');
    expect(translate('in 3 hours', 'ta')).toBe('3 மணி நேரம் மீதம்');
    expect(translate('finished 2 days late', 'hi')).toBe('2 दिन देरी से पूरा हुआ');
  });
  it('keeps complete Tamil and Hindi entries', () => {
    for (const [key, values] of Object.entries(messages)) {
      expect(values, key).toHaveLength(2);
      expect(
        values.every((value) => value.trim().length > 0),
        key,
      ).toBe(true);
    }
  });
  it('renders the server-selected language immediately', () => {
    render(
      <LanguageProvider initialLocale="ta">
        <T>Start work</T>
      </LanguageProvider>,
    );
    expect(screen.getByText('பணியைத் தொடங்கவும்')).toBeTruthy();
  });
  it('changes language, HTML lang, and persistent cookie without changing user content', () => {
    render(
      <LanguageProvider initialLocale="en">
        <LanguageSelector />
        <T>Start work</T>
        <p>Customer drawing ABC-123</p>
      </LanguageProvider>,
    );
    fireEvent.change(screen.getByLabelText('Language'), { target: { value: 'hi' } });
    expect(screen.getByText('काम शुरू करें')).toBeTruthy();
    expect(screen.getByText('Customer drawing ABC-123')).toBeTruthy();
    expect(document.documentElement.lang).toBe('hi');
    expect(document.cookie).toContain('jtas-language=hi');
    expect(refresh).toHaveBeenCalled();
  });
});
