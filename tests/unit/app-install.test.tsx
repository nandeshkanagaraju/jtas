/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppInstallPanel, AppInstallProvider } from '@/components/shared/app-install';

beforeEach(() => {
  vi.stubGlobal('isSecureContext', true);
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function setup() {
  render(
    <AppInstallProvider>
      <AppInstallPanel />
    </AppInstallProvider>,
  );
}
function offer(outcome: 'accepted' | 'dismissed', prompt = vi.fn().mockResolvedValue(undefined)) {
  const event = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
    prompt,
    userChoice: Promise.resolve({ outcome }),
  });
  act(() => {
    window.dispatchEvent(event);
  });
  return prompt;
}

describe('phone installation', () => {
  it('offers manual instructions without a nonfunctional install button', () => {
    setup();
    expect(screen.queryByRole('button', { name: 'Install Jaraa' })).toBeNull();
    expect(screen.getByText(/On Android, open this site in Chrome/)).toBeTruthy();
  });
  it('waits for browser confirmation before reporting an installation', async () => {
    setup();
    const prompt = offer('accepted');
    fireEvent.click(screen.getByRole('button', { name: 'Install Jaraa' }));
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toContain('Installation requested'),
    );
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/is installed or running/)).toBeNull();
    act(() => {
      window.dispatchEvent(new Event('appinstalled'));
    });
    expect(screen.getByText(/is installed or running/)).toBeTruthy();
  });
  it('handles dismissal without reusing the consumed browser prompt', async () => {
    setup();
    offer('dismissed');
    fireEvent.click(screen.getByRole('button', { name: 'Install Jaraa' }));
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toContain('Installation cancelled'),
    );
    expect(screen.queryByRole('button', { name: 'Install Jaraa' })).toBeNull();
  });
  it('recovers when the browser rejects the prompt', async () => {
    setup();
    offer('accepted', vi.fn().mockRejectedValue(new Error('Unavailable')));
    fireEvent.click(screen.getByRole('button', { name: 'Install Jaraa' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('could not open'));
  });
  it('explains why plain HTTP phone URLs cannot install', () => {
    vi.stubGlobal('isSecureContext', false);
    setup();
    expect(screen.getByText(/Open the secure HTTPS address/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Install Jaraa' })).toBeNull();
  });
});
