'use client';

import { formatDrawNumber } from '@daily-draw/shared';
import type { ReactNode } from 'react';
import { txMessage, type TxState } from '../lib/game';
import { RULES } from '../lib/tickets';

export function num(value: number): string {
  return formatDrawNumber(value, RULES.numberRange);
}

export function NumberBadge({
  value,
  size,
  win,
}: {
  value: number;
  size?: 'sm' | 'lg';
  win?: boolean;
}) {
  const cls = ['num', size ? `num-${size}` : '', win ? 'num-win' : ''].filter(Boolean).join(' ');
  return <span className={cls}>{num(value)}</span>;
}

export function Notice({
  tone = 'info',
  children,
}: {
  tone?: 'info' | 'warn' | 'error';
  children: ReactNode;
}) {
  const cls = tone === 'info' ? 'notice' : `notice notice-${tone}`;
  return (
    <div className={cls} role={tone === 'error' ? 'alert' : 'status'}>
      {children}
    </div>
  );
}

/** Progress or error line for a running transaction flow. */
export function TxNotice({ state }: { state: TxState }) {
  const message = txMessage(state);
  if (!message) return null;
  return <Notice tone={state.phase === 'error' ? 'error' : 'info'}>{message}</Notice>;
}

const ICONS: Record<string, ReactNode> = {
  home: (
    <>
      <path d="M3 11l9-7 9 7" />
      <path d="M5 10v10h14V10" />
    </>
  ),
  play: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M8 10h.01M12 10h.01M16 10h.01M8 14h.01M12 14h.01M16 14h.01" />
    </>
  ),
  results: (
    <>
      <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
    </>
  ),
  referrals: (
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20c.8-3.5 3.4-5.5 6.5-5.5s5.7 2 6.5 5.5" />
      <path d="M17 7v6M14 10h6" />
    </>
  ),
  wallet: (
    <>
      <rect x="3" y="6" width="18" height="13" rx="2" />
      <path d="M16 12h2" />
      <path d="M3 9h18" />
    </>
  ),
  back: <path d="M15 18l-6-6 6-6" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
};

export function Icon({ name, size = 24, color }: { name: string; size?: number; color?: string }) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color ?? 'currentColor'}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {ICONS[name]}
    </svg>
  );
}
