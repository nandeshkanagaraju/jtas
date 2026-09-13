import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';

import { ServiceWorkerRegistration } from '@/components/shared/service-worker';

import './globals.css';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
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
  themeColor: '#0f172a',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.variable} font-sans antialiased`}>
        {children}
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}
