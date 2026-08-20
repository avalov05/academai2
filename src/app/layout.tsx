import type { Metadata } from 'next';
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
