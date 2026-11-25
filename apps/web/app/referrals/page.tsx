'use client';

import { formatUsdc } from '@daily-draw/shared';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { zeroAddress, type Address } from 'viem';
import { useConfig, usePublicClient, useReadContract } from 'wagmi';
import { writeContract } from 'wagmi/actions';
import { AppShell } from '../../components/AppShell';
import { Notice, TxNotice } from '../../components/ui';
import { ConnectPrompt } from '../../components/Wallet';
import { appConfig } from '../../lib/config';
import { CONFIGURED, GAME, useGame, usePlayer, useTransactions } from '../../lib/game';
import { referralLink, shortAddress } from '../../lib/referral';

function useReferralHistory(referrer: Address | undefined) {
  const client = usePublicClient();
  return useQuery({
    queryKey: ['referrals', appConfig.chain.id, referrer],
    enabled: !!client && !!referrer && CONFIGURED,
    queryFn: async () => {
      const [joined, credited] = await Promise.all([
        client!.getContractEvents({
          ...GAME,
          eventName: 'ReferrerSet',
          args: { referrer },
          fromBlock: appConfig.startBlock,
        }),
        client!.getContractEvents({
          ...GAME,
          eventName: 'ReferralCredited',
          args: { referrer },
          fromBlock: appConfig.startBlock,
        }),
      ]);
      const earnedFrom = new Map<string, bigint>();
      for (const log of credited) {
        const player = log.args.player!;
        earnedFrom.set(player, (earnedFrom.get(player) ?? 0n) + log.args.amount!);
      }
      return {
        friends: joined.map((log) => log.args.player!).reverse(),
        earnedFrom,
        lifetime: credited.reduce((sum, log) => sum + log.args.amount!, 0n),
      };
    },
  });
}

export default function ReferralsPage() {
  const config = useConfig();
  const { address, isConnected, wrongChain } = usePlayer();
  const { currentId } = useGame();
  const history = useReferralHistory(address);
  const tx = useTransactions();
  const [copied, setCopied] = useState(false);
  const player = address ?? zeroAddress;
  const enabled = CONFIGURED && !!address;
  const { data: balance = 0n } = useReadContract({
    ...GAME,
    functionName: 'referralBalance',
    args: [player],
    query: { enabled },
  });
  const { data: active } = useReadContract({
    ...GAME,
    functionName: 'isActiveReferrer',
    args: [player, currentId ?? 0n],
    query: { enabled: enabled && currentId !== undefined },
  });
  const { data: myReferrer } = useReadContract({
    ...GAME,
    functionName: 'referrerOf',
    args: [player],
    query: { enabled },
  });

  const link =
    address && typeof window !== 'undefined' ? referralLink(window.location.origin, address) : '';
  const copy = async () => {
    await navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  const share = async () => {
    if (navigator.share) {
      await navigator
        .share({ title: 'Daily Draw', text: 'Pick a number in tonight’s $1 draw:', url: link })
        .catch(() => undefined);
    } else {
      await copy();
    }
  };
  const claim = () =>
    tx.run(async (step) => {
      const r = await step('Claiming referral earnings', () =>
        writeContract(config, {
          ...GAME,
          functionName: 'claimReferral',
          chainId: appConfig.chain.id,
        }),
      );
      return r.transactionHash;
    });

  return (
    <AppShell>
      <h1 className="page-title">Referrals</h1>
      <p className="muted" style={{ margin: 0, fontSize: 15, lineHeight: 1.5 }}>
        Share your link. When a friend you brought wins, you get a share of the 20% of the pool set
        aside for referrers, paid in test USDC.
      </p>

      {!isConnected || !address ? (
        <ConnectPrompt label="Connect wallet to get your link" />
      ) : (
        <>
          <section
            className="card"
            aria-label="Your link"
            style={{ display: 'flex', flexDirection: 'column', gap: 10 }}
          >
            <span style={{ fontWeight: 600 }}>Your link</span>
            <code
              data-testid="referral-link"
              style={{
                wordBreak: 'break-all',
                fontSize: 13,
                background: 'var(--ground)',
                padding: '10px 12px',
                borderRadius: 10,
              }}
            >
              {link}
            </code>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <button type="button" className="btn btn-secondary" onClick={copy}>
                {copied ? 'Copied' : 'Copy link'}
              </button>
              <button type="button" className="btn btn-primary" onClick={share}>
                Share
              </button>
            </div>
            <span className="muted" style={{ fontSize: 13 }}>
              Your code is your wallet address, {shortAddress(address)}. A friend is linked to you
              on their first ticket, for good.
            </span>
          </section>

          {active === false && (
            <Notice tone="warn">
              You earn only if you played in the 30 days before a draw.{' '}
              <Link href="/play" style={{ fontWeight: 600 }}>
                Buy a ticket
              </Link>{' '}
              to stay active.
            </Notice>
          )}

          <section
            className="card"
            aria-label="Earnings"
            style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
          >
            <dl className="stats">
              <div>
                <dt>Ready to claim</dt>
                <dd className="display" style={{ fontSize: 26 }} data-testid="referral-balance">
                  {formatUsdc(balance)}
                </dd>
              </div>
              <div>
                <dt>Earned in total</dt>
                <dd className="display" style={{ fontSize: 26 }}>
                  {formatUsdc(history.data?.lifetime ?? 0n)}
                </dd>
              </div>
              <div>
                <dt>Friends referred</dt>
                <dd>{history.data?.friends.length ?? '…'}</dd>
              </div>
              <div>
                <dt>Status</dt>
                <dd>{active === undefined ? '…' : active ? 'Active' : 'Inactive'}</dd>
              </div>
            </dl>
            <button
              type="button"
              className="btn btn-gold btn-block"
              disabled={balance === 0n || tx.busy || wrongChain}
              onClick={claim}
            >
              {balance === 0n ? 'Nothing to claim yet' : `Claim ${formatUsdc(balance)}`}
            </button>
            <TxNotice state={tx.state} />
          </section>

          <section
            aria-label="Friends"
            style={{ display: 'flex', flexDirection: 'column', gap: 10 }}
          >
            <div className="section-head">
              <h2>Friends you brought</h2>
            </div>
            {history.data && history.data.friends.length > 0 ? (
              <div className="list">
                {history.data.friends.map((friend) => (
                  <div className="list-row" key={friend}>
                    <span style={{ flex: 1, fontFamily: 'monospace', fontSize: 14 }}>
                      {shortAddress(friend)}
                    </span>
                    <span className="muted" style={{ fontSize: 14 }}>
                      {formatUsdc(history.data.earnedFrom.get(friend) ?? 0n)} earned
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="card muted" style={{ fontSize: 14 }}>
                {history.isLoading ? 'Loading…' : 'No friends yet. Share your link to invite some.'}
              </div>
            )}
          </section>

          {myReferrer && myReferrer !== zeroAddress && (
            <p className="muted" style={{ fontSize: 13, margin: 0 }}>
              You were invited by {shortAddress(myReferrer)}.
            </p>
          )}
        </>
      )}
    </AppShell>
  );
}
