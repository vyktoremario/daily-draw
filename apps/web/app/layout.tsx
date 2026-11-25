import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { colors, fonts } from '@daily-draw/ui';
import { DemoBanner } from '../components/DemoBanner';
import { Providers } from './providers';
import './globals.css';

export const metadata: Metadata = {
  title: 'Daily Draw',
  description:
    'A daily number draw you can verify yourself. A portfolio demo on a testnet: test USDC only, no real money.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: colors.night,
};

/** The design tokens from @daily-draw/ui, as CSS variables for globals.css. */
const tokenCss = `:root{${Object.entries(colors)
  .map(([name, value]) => `--${name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}:${value}`)
  .join(';')};--font-body:${fonts.body};--font-display:${fonts.display}}`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Space+Grotesk:wght@500;700&display=swap"
        />
        <style>{tokenCss}</style>
      </head>
      <body>
        <DemoBanner />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
