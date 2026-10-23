'use client';

import { T } from '@/lib/i18n/provider';

import { CheckCircle2, Download, Smartphone } from 'lucide-react';
import { createContext, useContext, useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Panel } from '@/components/shared/panel';

interface InstallPrompt extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

interface InstallState {
  ready: boolean;
  installed: boolean;
  secure: boolean;
  ios: boolean;
  busy: boolean;
  message: string;
  install(): Promise<void>;
}

const InstallContext = createContext<InstallState | null>(null);

/** Capture availability at the root so navigating to Account cannot lose the event. */
export function AppInstallProvider({ children }: { children: React.ReactNode }) {
  const pending = useRef<InstallPrompt | null>(null);
  const [ready, setReady] = useState(false);
  const [installed, setInstalled] = useState(false);
  const [secure, setSecure] = useState(true);
  const [ios, setIos] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    const display = window.matchMedia('(display-mode: standalone)');
    const standalone = () => {
      if (display.matches || (navigator as Navigator & { standalone?: boolean }).standalone) {
        setInstalled(true);
      }
    };
    standalone();
    setSecure(window.isSecureContext);
    setIos(
      /iPad|iPhone|iPod/.test(navigator.userAgent) ||
        (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1),
    );
    const available = (event: Event) => {
      event.preventDefault();
      pending.current = event as InstallPrompt;
      setReady(true);
      setMessage('');
    };
    const completed = () => {
      pending.current = null;
      setReady(false);
      setInstalled(true);
      setMessage('');
    };
    window.addEventListener('beforeinstallprompt', available);
    window.addEventListener('appinstalled', completed);
    display.addEventListener('change', standalone);
    return () => {
      window.removeEventListener('beforeinstallprompt', available);
      window.removeEventListener('appinstalled', completed);
      display.removeEventListener('change', standalone);
    };
  }, []);

  async function install() {
    const event = pending.current;
    if (!event || busy) return;
    pending.current = null;
    setReady(false);
    setBusy(true);
    try {
      await event.prompt();
      const choice = await event.userChoice;
      setMessage(
        choice.outcome === 'accepted'
          ? 'Installation requested. Follow your browser’s instructions, then open Jaraa from your home screen.'
          : 'Installation cancelled. You can keep using the website and install later from your browser menu.',
      );
    } catch {
      setMessage('The installation prompt could not open. Try installing from your browser menu.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <InstallContext.Provider value={{ ready, installed, secure, ios, busy, message, install }}>
      {children}
    </InstallContext.Provider>
  );
}

export function AppInstallPanel() {
  const state = useContext(InstallContext);
  if (!state) return null;
  const { ready, installed, secure, ios, busy, message, install } = state;

  return (
    <div id="install" className="scroll-mt-40">
      <Panel
        title={<T>{'Jaraa on your phone'}</T>}
        description={<T>{'Your workspace, one tap from the home screen.'}</T>}
      >
        <div className="flex items-start gap-4">
          <span className="bg-primary/10 text-action flex size-12 shrink-0 items-center justify-center rounded-lg">
            {installed ? <CheckCircle2 aria-hidden /> : <Smartphone aria-hidden />}
          </span>
          <div className="min-w-0 space-y-3 text-sm">
            {installed ? (
              <p>
                <T>{'Jaraa is installed or running as an app on this device.'}</T>
              </p>
            ) : (
              <>
                <p>
                  <T>
                    {
                      'Open your tasks, drawings and reports in a dedicated app window. No Play Store download is needed. '
                    }
                  </T>
                </p>
                {!secure ? (
                  <p className="text-destructive">
                    <T>
                      {
                        'Open the secure HTTPS address to install on your phone. A local HTTP network address cannot offer app installation. '
                      }
                    </T>
                  </p>
                ) : ready ? (
                  <Button onClick={install} disabled={busy}>
                    <Download aria-hidden /> <T>{' Install Jaraa '}</T>
                  </Button>
                ) : ios ? (
                  <p>
                    <T>{'In Safari, open Share, choose Add to Home Screen, then confirm Add.'}</T>
                  </p>
                ) : (
                  <p>
                    <T>
                      {
                        'On Android, open this site in Chrome. Open the browser menu and choose Install app or Add to Home screen. On desktop, look for the install icon in the address bar. '
                      }
                    </T>
                  </p>
                )}
              </>
            )}
            <p role="status" aria-live="polite">
              {busy ? <T>{'Opening installation…'}</T> : message}
            </p>
            <p className="text-muted-foreground text-xs">
              <T>
                {
                  'An internet connection is required to load current work and save updates. Enable push notifications in your account after installation. Email and Telegram alerts continue. '
                }
              </T>
            </p>
          </div>
        </div>
      </Panel>
    </div>
  );
}
