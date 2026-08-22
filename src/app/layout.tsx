import type { Metadata, Viewport } from 'next';
import '@fontsource-variable/plus-jakarta-sans';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import '@fontsource/inter/800.css';
import './globals.css';
import Background from '@/components/Background';

export const metadata: Metadata = {
  title: 'AcademAI',
  description: 'Everything you owe anyone, in one place. Built for the 4.0.',
  manifest: '/manifest.webmanifest',
  // iOS only allows web push to a site added to the Home Screen, and only
  // reads these tags to decide how it behaves once it is there
  appleWebApp: { capable: true, title: 'AcademAI', statusBarStyle: 'default' },
  icons: { icon: '/icon-192.png', apple: '/apple-touch-icon.png' },
};

export const viewport: Viewport = {
  themeColor: '#EFEFEA',
  viewportFit: 'cover',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Background />
        {children}
      </body>
    </html>
  );
}
