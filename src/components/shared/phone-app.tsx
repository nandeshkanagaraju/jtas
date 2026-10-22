'use client';

import { ChevronDown } from 'lucide-react';
import { Children, createContext, useContext, useState, useSyncExternalStore } from 'react';

import { Button } from '@/components/ui/button';

const PhoneAppContext = createContext(false);
const QUERIES = ['(display-mode: standalone)', '(display-mode: fullscreen)', '(max-width: 1023px)'];

function subscribe(changed: () => void) {
  const media = QUERIES.map((query) => window.matchMedia(query));
  media.forEach((item) => item.addEventListener('change', changed));
  return () => media.forEach((item) => item.removeEventListener('change', changed));
}

function installedPhone() {
  return (
    window.matchMedia(QUERIES[2]).matches &&
    (window.matchMedia(QUERIES[0]).matches ||
      window.matchMedia(QUERIES[1]).matches ||
      Boolean((navigator as Navigator & { standalone?: boolean }).standalone))
  );
}

export function PhoneAppProvider({ children }: { children: React.ReactNode }) {
  const phone = useSyncExternalStore(subscribe, installedPhone, () => false);
  return <PhoneAppContext.Provider value={phone}>{children}</PhoneAppContext.Provider>;
}

export function usePhoneApp() {
  return useContext(PhoneAppContext);
}

export function PhoneAppMain({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const phone = usePhoneApp();
  return (
    <main data-phone-app={phone ? 'true' : undefined} className={className}>
      {children}
    </main>
  );
}

/** Browser views keep exactly their original markup; installed phones disclose detail on demand. */
export function PhoneDisclosure({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  const phone = usePhoneApp();
  if (!phone) return <>{children}</>;
  return (
    <details className="phone-disclosure">
      <summary>
        <span className="min-w-0">
          <span className="block font-medium">{title}</span>
          {hint ? <span className="text-muted-foreground mt-0.5 block text-xs">{hint}</span> : null}
        </span>
        <ChevronDown className="size-4 shrink-0" aria-hidden />
      </summary>
      <div className="phone-disclosure-body">{children}</div>
    </details>
  );
}

export function PhoneQueue({ children }: { children: React.ReactNode }) {
  const phone = usePhoneApp();
  const [expanded, setExpanded] = useState(false);
  const rows = Children.toArray(children);
  if (!phone) return <ol className="divide-y">{children}</ol>;
  return (
    <>
      <ol className="divide-y">{expanded ? rows : rows.slice(0, 3)}</ol>
      {rows.length > 3 ? (
        <div className="border-t p-3">
          <Button
            className="w-full"
            variant="ghost"
            aria-expanded={expanded}
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? 'Show fewer items' : `Show all ${rows.length} items`}
          </Button>
        </div>
      ) : null}
    </>
  );
}
