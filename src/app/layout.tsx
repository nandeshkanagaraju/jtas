import type { Metadata, Viewport } from 'next';
import { Archivo, IBM_Plex_Mono, Instrument_Sans } from 'next/font/google';

import { ServiceWorkerRegistration } from '@/components/shared/service-worker';

import './globals.css';

/*
 * Two grotesques of different proportions rather than a display face with
 * personality of its own: Instrument Sans is narrow and quiet enough to carry
 * 14px body text in dense tables, Archivo is wider and sturdier, so a heading
 * reads as a heading without needing extra size or weight.
 */
const instrument = Instrument_Sans({
  subsets: ['latin'],
  variable: '--font-instrument',
  display: 'swap',
});

const archivo = Archivo({
  subsets: ['latin'],
  weight: ['500', '600', '700'],
  variable: '--font-archivo',
  display: 'swap',
});

const plex = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-plex',
  display: 'swap',
});

export const metadata: Metadata = {
  title: {
    default: 'JTAS — Jaraa Task & Accountability System',
    template: '%s · JTAS',
  },
  description:
    'Assign it once, and the system does the following up. Job and subtask tracking for Jaraa Global Engineering Pvt Ltd.',
  robots: { index: false, follow: false },
  // PWA (build spec M5.6): installable on a shop-floor phone, so My Tasks is
  // one tap from the home screen rather than a bookmark in a browser.
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, title: 'JTAS', statusBarStyle: 'black-translucent' },
  icons: {
    icon: [
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: '/icons/apple-touch-icon.png',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // The shop-floor UI must remain zoomable for readability.
  maximumScale: 5,
  themeColor: '#f5f4ef',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${instrument.variable} ${archivo.variable} ${plex.variable} font-sans antialiased`}
      >
        {children}
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}
