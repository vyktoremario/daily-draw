'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { appConfig } from '../lib/config';
import { CONFIGURED, useDeployed } from '../lib/game';
import { Icon, Notice } from './ui';
import { NetworkBanner, WalletButton } from './Wallet';

const TABS = [
  { href: '/', label: 'Home', icon: 'home' },
  { href: '/play', label: 'Play', icon: 'play' },
  { href: '/results', label: 'Results', icon: 'results' },
  { href: '/referrals', label: 'Referrals', icon: 'referrals' },
] as const;

/** Wallet state only exists in the browser: render pages after mount to avoid hydration drift. */
export function useMounted(): boolean {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted;
}

function SetupProblem() {
  const deployed = useDeployed();
  if (!CONFIGURED) {
    return (
      <Notice tone="warn">
        No contract addresses configured for {appConfig.chain.name}. Locally, run{' '}
        <code>pnpm dev:chain</code> and restart the web app.
      </Notice>
    );
  }
  if (deployed === false) {
    return (
      <Notice tone="warn">
        The game contract isn&apos;t on {appConfig.chain.name} at the configured address.
        {appConfig.chainKey === 'anvil' && (
          <>
            {' '}
            Anvil forgets everything when it restarts: run <code>pnpm dev:chain</code> again.
          </>
        )}
      </Notice>
    );
  }
  return null;
}

export function AppShell({
  children,
  title,
  back,
  hideNav,
}: {
  children: ReactNode;
  /** Focused flows (picking numbers) hide the tab bar, as in the mockups. */
  hideNav?: boolean;
  /** Page title next to a back link, instead of the logo. */
  title?: string;
  back?: string;
}) {
  const pathname = usePathname();
  const mounted = useMounted();
  return (
    <div className="shell">
      <header className="topbar">
        {back ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
            <Link href={back} className="btn btn-ghost" aria-label="Back" style={{ padding: 0 }}>
              <Icon name="back" />
            </Link>
            <h1 className="page-title" style={{ fontSize: 22 }}>
              {title}
            </h1>
          </div>
        ) : (
          <Link href="/" className="logo">
            Daily<span>Draw</span>
          </Link>
        )}
        {mounted && <WalletButton />}
      </header>
      <main className="content">
        {appConfig.isTestnet && (
          <span className="pill pill-grey" style={{ alignSelf: 'flex-start' }}>
            {appConfig.chain.name} · test USDC only
          </span>
        )}
        {mounted ? (
          <>
            <SetupProblem />
            <NetworkBanner />
            {children}
          </>
        ) : (
          <p className="muted">Loading…</p>
        )}
      </main>
      {!hideNav && (
        <nav className="tabbar" aria-label="Main">
          {TABS.map((tab) => {
            const active = tab.href === '/' ? pathname === '/' : pathname.startsWith(tab.href);
            return (
              <Link key={tab.href} href={tab.href} aria-current={active ? 'page' : undefined}>
                <Icon name={tab.icon} />
                {tab.label}
              </Link>
            );
          })}
        </nav>
      )}
    </div>
  );
}
