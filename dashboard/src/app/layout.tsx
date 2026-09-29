import type { Metadata, Viewport } from 'next';
import './globals.css';
import { Providers } from './providers';
import { THEME_SCRIPT } from '@/components/theme';

export const metadata: Metadata = {
  title: 'Open Gravity',
  description: 'Universal local AI router: one endpoint for every model.',
  icons: { icon: '/ui/logo.svg' },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: '#090a13' },
    { media: '(prefers-color-scheme: light)', color: '#f4f5f9' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
