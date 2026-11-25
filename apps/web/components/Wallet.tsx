'use client';

import { formatUsdc } from '@daily-draw/shared';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useConnect, useConnectors, useSwitchChain } from 'wagmi';
import { appConfig } from '../lib/config';
import { friendlyError } from '../lib/errors';
import { usePlayer, useUsdcBalance } from '../lib/game';
import { Icon, Notice } from './ui';

/** Header button: "Connect wallet", or the USDC balance linking to the wallet screen. */
export function WalletButton() {
  const { address, isConnected } = usePlayer();
  const { data: balance } = useUsdcBalance(address);
  const [open, setOpen] = useState(false);
  if (isConnected && address) {
    return (
      <Link href="/wallet" className="wallet-pill" aria-label="Wallet">
        <Icon name="wallet" size={18} color="var(--brand)" />
        {balance !== undefined ? formatUsdc(balance) : '…'}
      </Link>
    );
  }
  return (
    <>
      <button type="button" className="wallet-pill" onClick={() => setOpen(true)}>
        <Icon name="wallet" size={18} color="var(--brand)" />
        Connect wallet
      </button>
      {open && <ConnectSheet onClose={() => setOpen(false)} />}
    </>
  );
}

/** A full-width connect button for empty states ("Connect a wallet to play"). */
export function ConnectPrompt({ label = 'Connect wallet' }: { label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="btn btn-primary btn-block btn-lg"
        onClick={() => setOpen(true)}
      >
        {label}
      </button>
      {open && <ConnectSheet onClose={() => setOpen(false)} />}
    </>
  );
}

export function ConnectSheet({ onClose }: { onClose: () => void }) {
  const connectors = useConnectors();
  const { mutate, isPending, error, variables } = useConnect({
    mutation: { onSuccess: onClose },
  });
  const [hasInjected, setHasInjected] = useState(true);
  useEffect(() => {
    setHasInjected(!!(window as { ethereum?: unknown }).ethereum);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Wallets announced through EIP-6963 (MetaMask, Rabby…) replace the generic "Injected" entry.
  const announced = connectors.some((c) => c.type === 'injected' && c.id !== 'injected');
  const list = connectors.filter((c) => !(c.id === 'injected' && (announced || !hasInjected)));
  const label = (c: (typeof connectors)[number]) =>
    c.id === 'injected' ? 'Browser wallet' : c.id === 'walletConnect' ? 'WalletConnect' : c.name;

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="connect-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="section-head">
          <h2 id="connect-title">Connect a wallet</h2>
          <button type="button" className="btn btn-ghost" onClick={onClose} aria-label="Close">
            <Icon name="close" />
          </button>
        </div>
        <p className="muted" style={{ margin: 0, fontSize: 14 }}>
          You play with USDC from your own wallet. Daily Draw never holds your keys.
        </p>
        {list.map((c) => (
          <button
            key={c.uid}
            type="button"
            className="btn btn-secondary btn-block"
            disabled={isPending}
            onClick={() => mutate({ connector: c, chainId: appConfig.chain.id })}
            style={{ justifyContent: 'space-between' }}
          >
            {label(c)}
            {isPending && variables?.connector === c && <span className="muted">Opening…</span>}
          </button>
        ))}
        {!hasInjected && !announced && (
          <Notice>
            No browser wallet found. Install{' '}
            <a href="https://metamask.io/download/" target="_blank" rel="noreferrer">
              MetaMask
            </a>
            {appConfig.walletConnectProjectId ? ', or use WalletConnect with a phone wallet.' : '.'}
          </Notice>
        )}
        {error && <Notice tone="error">{friendlyError(error)}</Notice>}
      </div>
    </div>
  );
}

/** Shown when the wallet is on another network. */
export function NetworkBanner() {
  const { wrongChain } = usePlayer();
  const { mutate, isPending, error } = useSwitchChain();
  if (!wrongChain) return null;
  return (
    <Notice tone="warn">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span>Your wallet is on another network. Daily Draw runs on {appConfig.chain.name}.</span>
        <button
          type="button"
          className="btn btn-primary"
          disabled={isPending}
          onClick={() => mutate({ chainId: appConfig.chain.id })}
        >
          Switch to {appConfig.chain.name}
        </button>
        {error && <span>{friendlyError(error)}</span>}
      </div>
    </Notice>
  );
}
