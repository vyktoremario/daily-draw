'use client';

import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';
import { formatEther, type Address, type Hash } from 'viem';
import { useBalance, useConfig, useGasPrice } from 'wagmi';
import { waitForTransactionReceipt } from 'wagmi/actions';
import { appConfig } from '../lib/config';
import type { DripRefusal, DripStatus } from '../lib/drip';
import { Notice } from './ui';

/** Gas for a simple transaction (the USDC faucet, an approval), with headroom. */
const TX_GAS = 150_000n;
const ATTEMPTED_KEY = 'dailydraw.drip.attempted';

type DripPhase = 'idle' | 'sending' | 'confirming' | 'done' | 'unavailable' | 'error';

/** One automatic attempt per address per browser session (and one in flight at a time). */
const inFlight = new Set<string>();
function attempted(address: Address): boolean {
  try {
    return window.sessionStorage.getItem(`${ATTEMPTED_KEY}.${address}`) === '1';
  } catch {
    return false;
  }
}
function markAttempted(address: Address) {
  try {
    window.sessionStorage.setItem(`${ATTEMPTED_KEY}.${address}`, '1');
  } catch {
    // Private mode: the server still drips only once per address.
  }
}

/**
 * The connected wallet's gas (test ETH) and the gas drip (`/api/drip`). A testnet wallet that
 * can't pay for a transaction gets the drip automatically once; `request` retries it by hand.
 */
export function useGasDrip(address: Address | undefined) {
  const config = useConfig();
  const enabled = appConfig.isTestnet && !!address;
  const gas = useBalance({ address, query: { enabled: !!address } });
  const { data: gasPrice } = useGasPrice({ query: { enabled } });
  const status = useQuery({
    queryKey: ['drip-status'],
    enabled,
    staleTime: 60_000,
    queryFn: async (): Promise<DripStatus | null> => {
      const response = await fetch('/api/drip', { cache: 'no-store' });
      return response.ok ? ((await response.json()) as DripStatus) : null;
    },
  });
  const [phase, setPhase] = useState<DripPhase>('idle');
  const [reason, setReason] = useState<DripRefusal | null>(null);
  const [amountWei, setAmountWei] = useState<bigint | null>(null);

  const balance = gas.data?.value;
  /** Too little to pay for one transaction. */
  const noGas =
    enabled &&
    balance !== undefined &&
    (gasPrice !== undefined ? balance < gasPrice * TX_GAS * 2n : balance === 0n);
  /** Below the drip's threshold (it may still cover a transaction or two). */
  const low =
    noGas ||
    (balance !== undefined && !!status.data && balance < BigInt(status.data.minBalanceWei));

  const request = useCallback(async () => {
    if (!address || inFlight.has(address)) return;
    inFlight.add(address);
    markAttempted(address);
    setPhase('sending');
    setReason(null);
    try {
      const response = await fetch('/api/drip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address }),
      });
      const body = (await response.json()) as
        { ok: true; hash: Hash; amountWei: string } | { ok: false; reason: DripRefusal };
      if (!body.ok) {
        if (body.reason === 'has-gas') {
          setPhase('idle');
          await gas.refetch();
        } else {
          setReason(body.reason);
          setPhase(body.reason === 'busy' ? 'error' : 'unavailable');
        }
        return;
      }
      setAmountWei(BigInt(body.amountWei));
      setPhase('confirming');
      await waitForTransactionReceipt(config, { hash: body.hash, chainId: appConfig.chain.id });
      await gas.refetch();
      setPhase('done');
    } catch {
      setPhase('error');
    } finally {
      inFlight.delete(address);
    }
  }, [address, config, gas]);

  useEffect(() => {
    setPhase('idle');
    setReason(null);
  }, [address]);

  // Automatic first try for a wallet that can't pay for anything yet.
  useEffect(() => {
    if (!address || !noGas || phase !== 'idle' || !status.isSuccess) return;
    if (!status.data?.available) {
      setPhase('unavailable');
      return;
    }
    if (!attempted(address)) void request();
  }, [address, noGas, phase, status.isSuccess, status.data, request]);

  return {
    enabled,
    noGas,
    low,
    phase,
    reason,
    amountWei: amountWei ?? (status.data ? BigInt(status.data.amountWei) : null),
    available: status.data?.available ?? false,
    request,
  };
}

export type GasDripState = ReturnType<typeof useGasDrip>;

function ethAmount(wei: bigint | null): string {
  return wei === null ? 'a little' : `${formatEther(wei)}`;
}

const FAUCETS: Partial<Record<string, { name: string; url: string }[]>> = {
  baseSepolia: [
    { name: 'Coinbase', url: 'https://portal.cdp.coinbase.com/products/faucet' },
    { name: 'Alchemy', url: 'https://www.alchemy.com/faucets/base-sepolia' },
  ],
};

/** Progress, success, or what to do instead, for the gas drip. Nothing while gas is fine. */
export function GasDrip({ drip }: { drip: GasDripState }) {
  const symbol = appConfig.chain.nativeCurrency.symbol;
  if (!drip.enabled) return null;
  const amount = `${ethAmount(drip.amountWei)} test ${symbol}`;

  if (drip.phase === 'sending' || drip.phase === 'confirming') {
    return (
      <Notice>
        {drip.phase === 'sending'
          ? `Sending you ${amount} for network fees…`
          : `Sending you ${amount} for network fees: waiting for the network…`}
      </Notice>
    );
  }
  if (drip.phase === 'done') {
    return <Notice>You got {amount} for network fees. You’re ready to go.</Notice>;
  }
  if (!drip.noGas) return null;

  if (drip.phase === 'unavailable') {
    const faucets = FAUCETS[appConfig.chainKey];
    return (
      <Notice tone="warn">
        Your wallet needs a little test {symbol} for network fees, and we can’t send it right now
        {drip.reason === 'already-dripped' ? ' (this wallet already had its top-up)' : ''}. Ask the
        person who invited you for test {symbol}
        {faucets ? (
          <>
            , or get some from a public faucet:{' '}
            {faucets.map((f, i) => (
              <span key={f.url}>
                {i > 0 && ' or '}
                <a href={f.url} target="_blank" rel="noreferrer">
                  {f.name}
                </a>
              </span>
            ))}
          </>
        ) : null}
        .
      </Notice>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <Notice tone={drip.phase === 'error' ? 'warn' : 'info'}>
        {drip.phase === 'error'
          ? `Couldn’t send test ${symbol} just now. Try again in a moment.`
          : `Your wallet needs a little test ${symbol} for network fees. We’ll send you ${amount} for free.`}
      </Notice>
      <button
        type="button"
        className="btn btn-secondary btn-block"
        onClick={() => void drip.request()}
      >
        Get {amount} for fees
      </button>
    </div>
  );
}

/** Self-contained version, for screens that only need the notice (the play screen). */
export function GasDripNotice({ address }: { address: Address | undefined }) {
  const drip = useGasDrip(address);
  return <GasDrip drip={drip} />;
}
