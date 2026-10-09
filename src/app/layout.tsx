import type { Metadata, Viewport } from 'next';
import { headers } from 'next/headers';
import { Geist, Geist_Mono } from 'next/font/google';

import { ServiceWorkerRegistration } from '@/components/shared/service-worker';
import { ThemeProvider } from '@/components/shared/theme';

import './globals.css';

/*
 * One superfamily. Geist carries the UI; Geist Mono carries every code,
 * deadline, count and station label. Hierarchy is size and weight.
 */
const geist = Geist({
  subsets: ['latin'],
  variable: '--font-geist',
  display: 'swap',
});

const geistMono = Geist_Mono({
  subsets: ['latin'],
  variable: '--font-geist-mono',
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
  // Day and night values, so the phone's own chrome follows the theme.
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f4f6f8' },
    { media: '(prefers-color-scheme: dark)', color: '#121418' },
  ],
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  /*
   * next-themes writes the chosen class before paint with an inline script, and
   * the CSP this app sends has no `unsafe-inline` — so it needs the same nonce
   * the middleware minted for this request, or the theme flashes to light on
   * every navigation and the console fills with CSP violations.
   */
  const nonce = (await headers()).get('x-nonce') ?? undefined;

  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${geist.variable} ${geistMono.variable} font-sans antialiased`}>
        <ThemeProvider nonce={nonce}>
          {children}
          <ServiceWorkerRegistration />
        </ThemeProvider>
      </body>
    </html>
  );
}
