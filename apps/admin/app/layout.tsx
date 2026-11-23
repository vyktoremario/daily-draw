import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { colors, fonts } from '@daily-draw/ui';

export const metadata: Metadata = { title: 'Daily Draw — Admin' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body
        style={{ margin: 0, background: colors.ground, color: colors.ink, fontFamily: fonts.body }}
      >
        {children}
      </body>
    </html>
  );
}
