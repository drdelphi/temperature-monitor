import type { Metadata, Viewport } from 'next';
import { AppShell } from '@/components/AppShell';
import { SITE_URL } from '@/lib/config';
import './globals.css';

const NAME = 'Temperature monitor';
const DESCRIPTION = 'Watch temperatures and get alerts when they go out of range';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: NAME, template: `%s · ${NAME}` },
  description: DESCRIPTION,
  applicationName: NAME,
  manifest: '/site.webmanifest',
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: '16x16 32x32 48x48' },
      { url: '/icon-192.png', type: 'image/png', sizes: '192x192' },
      { url: '/icon-512.png', type: 'image/png', sizes: '512x512' },
    ],
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180' }],
    shortcut: ['/favicon.ico'],
  },
  openGraph: {
    type: 'website',
    url: '/',
    siteName: NAME,
    title: NAME,
    description: DESCRIPTION,
    locale: 'en',
    images: [
      {
        url: '/og-image.png',
        type: 'image/png',
        width: 1200,
        height: 630,
        alt: `${NAME} — ${DESCRIPTION}`,
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: NAME,
    description: DESCRIPTION,
    images: ['/og-image.png'],
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  /* Draw under the notch and home indicator; the layout pads itself with env(safe-area-inset-*). */
  viewportFit: 'cover',
  themeColor: '#10151c',
  colorScheme: 'dark',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
