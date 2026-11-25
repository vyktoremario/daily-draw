import type { Metadata } from 'next';
import type { CSSProperties, ReactNode } from 'react';
import { colors, fonts } from '@daily-draw/ui';
import './globals.css';

export const metadata: Metadata = {
  title: 'Daily Draw — Admin',
  robots: { index: false, follow: false },
};

const tokens = {
  '--ground': colors.ground,
  '--surface': colors.surface,
  '--ink': colors.ink,
  '--ink-muted': colors.inkMuted,
  '--border': colors.border,
  '--brand': colors.brand,
  '--brand-soft': colors.brandSoft,
  '--display': fonts.display,
  fontFamily: fonts.body,
} as CSSProperties;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={tokens}>{children}</body>
    </html>
  );
}
