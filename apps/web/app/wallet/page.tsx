'use client';

import { formatUsdc } from '@daily-draw/shared';
import { useState } from 'react';
import { formatEther } from 'viem';
import { useBalance, useConfig, useDisconnect } from 'wagmi';
import { writeContract } from 'wagmi/actions';
import { AppShell } from '../../components/AppShell';
import { Notice, TxNotice, num } from '../../components/ui';
import { ConnectPrompt } from '../../components/Wallet';
import { appConfig } from '../../lib/config';
import { USDC, usePlayer, usePurchases, useTransactions, useUsdcBalance } from '../../lib/game';
import { shortAddress } from '../../lib/referral';

export default function WalletPage() {
  const config = useConfig();
  const { address, isConnected, connector, wrongChain } = usePlayer();
  const { data: usdc } = useUsdcBalance(address);
  const { data: gas } = useBalance({ address, query: { enabled: !!address } });
  const purchases = usePurchases(address);
  const { mutate: disconnect } = useDisconnect();
  const tx = useTransactions();
  const [copied, setCopied] = useState(false);

  const faucet = () =>
    tx.run(async (step) => {
      const r = await step('Getting test USDC', () =>
        writeContract(config, { ...USDC, functionName: 'faucet', chainId: appConfig.chain.id }),
      );
      return r.transactionHash;
    });

  return (
    <AppShell title="Wallet" back="/">
      {!isConnected || !address ? (
        <ConnectPrompt />
      ) : (
        <>
          <section
            className="card"
            aria-label="Balance"
            style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
          >
            <div
              style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}
            >
              <span className="muted">USDC balance</span>
              <span
                className="display"
                style={{ fontSize: 32, fontWeight: 700 }}
                data-testid="usdc-balance"
              >
                {usdc !== undefined ? formatUsdc(usdc) : '…'}
              </span>
            </div>
            <div className="muted" style={{ fontSize: 13 }}>
              {gas
                ? `${Number(formatEther(gas.value)).toFixed(4)} ${gas.symbol} for network fees`
                : ''}
            </div>
            {appConfig.faucet && (
              <>
                <button
                  type="button"
                  className="btn btn-gold btn-block"
                  onClick={faucet}
                  disabled={tx.busy || wrongChain}
                >
                  Get $100 test USDC
                </button>
                <TxNotice state={tx.state} />
                {appConfig.chainKey !== 'anvil' && (
                  <span className="muted" style={{ fontSize: 13 }}>
                    You also need a little test {appConfig.chain.nativeCurrency.symbol} for network
                    fees, from a public faucet.
                  </span>
                )}
              </>
            )}
          </section>

          <section
            className="card"
            aria-label="Account"
            style={{ display: 'flex', flexDirection: 'column', gap: 10 }}
          >
            <dl className="stats">
              <div>
                <dt>Address</dt>
                <dd style={{ fontFamily: 'monospace' }}>{shortAddress(address)}</dd>
              </div>
              <div>
                <dt>Network</dt>
                <dd>{appConfig.chain.name}</dd>
              </div>
              <div>
                <dt>Wallet</dt>
                <dd>{connector?.name ?? '–'}</dd>
              </div>
            </dl>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={async () => {
                  await navigator.clipboard.writeText(address);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }}
              >
                {copied ? 'Copied' : 'Copy'}
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => disconnect()}>
                Disconnect
              </button>
            </div>
          </section>

          <section
            aria-label="Recent activity"
            style={{ display: 'flex', flexDirection: 'column', gap: 10 }}
          >
            <div className="section-head">
              <h2>Ticket purchases</h2>
            </div>
            {purchases.data && purchases.data.length > 0 ? (
              <ul className="list" style={{ margin: 0, padding: 0, listStyle: 'none' }}>
                {purchases.data.slice(0, 20).map((p) => (
                  <li className="list-row" key={p.txHash}>
                    <span style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <span style={{ fontWeight: 600, fontSize: 15 }}>
                        Tickets · {p.numbers.map(num).join(', ')}
                      </span>
                      <span className="muted" style={{ fontSize: 13 }}>
                        Draw #{p.drawId.toString()}
                      </span>
                    </span>
                    <span style={{ fontWeight: 600 }}>−{formatUsdc(p.price + p.fee)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="card muted" style={{ fontSize: 14 }}>
                {purchases.isLoading ? 'Loading…' : 'No tickets yet.'}
              </div>
            )}
          </section>

          <Notice>
            Prizes and referral earnings are claimed from the Results and Referrals screens and
            arrive in this wallet as USDC.
          </Notice>
        </>
      )}
    </AppShell>
  );
}
