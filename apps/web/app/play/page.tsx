'use client';

import { formatUsdc } from '@daily-draw/shared';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { zeroAddress, type Hash } from 'viem';
import { useConfig, useReadContract } from 'wagmi';
import { writeContract } from 'wagmi/actions';
import { AppShell } from '../../components/AppShell';
import { NumberBadge, Notice, TxNotice, num } from '../../components/ui';
import { GasDripNotice } from '../../components/GasDrip';
import { ConnectPrompt } from '../../components/Wallet';
import { appConfig } from '../../lib/config';
import { TERMS_PATH, readConsent, saveConsent } from '../../lib/consent';
import {
  CONFIGURED,
  DrawStatus,
  GAME,
  USDC,
  useChainNow,
  useGame,
  usePlayer,
  useTransactions,
  useUsdcBalance,
} from '../../lib/game';
import { REFERRAL_STORAGE_KEY, referrerForPurchase, shortAddress } from '../../lib/referral';
import {
  BUNDLES,
  availableBundles,
  bundleCost,
  formatFee,
  groupNumbers,
  isComplete,
  limitLine,
  luckyDip,
  placeNumber,
  pricingOf,
  resizeSlip,
  walletLimitOf,
  withinLimit,
  type Slip,
} from '../../lib/tickets';
import { drawTime, formatWatDate, formatWatTime } from '../../lib/time';

interface Bought {
  drawId: bigint;
  numbers: number[];
  total: bigint;
  hash: Hash;
  cutoff: bigint;
}

export default function PlayPage() {
  const [bought, setBought] = useState<Bought | null>(null);
  return (
    <AppShell title={bought ? 'Tickets bought' : 'Play'} back="/" hideNav>
      {bought ? (
        <Confirmation bought={bought} onAgain={() => setBought(null)} />
      ) : (
        <Picker onBought={setBought} />
      )}
    </AppShell>
  );
}

function Picker({ onBought }: { onBought: (b: Bought) => void }) {
  const config = useConfig();
  const { currentId, current } = useGame();
  const { address, isConnected, wrongChain } = usePlayer();
  const now = useChainNow();
  const { data: balance } = useUsdcBalance(address);
  const player = address ?? zeroAddress;
  const enabled = CONFIGURED && !!address && currentId !== undefined;
  const { data: alreadyBought = 0n } = useReadContract({
    ...GAME,
    functionName: 'ticketsBoughtBy',
    args: [currentId ?? 0n, player],
    query: { enabled },
  });
  const { data: lastPlayed = 0n } = useReadContract({
    ...GAME,
    functionName: 'lastPlayed',
    args: [player],
    query: { enabled },
  });
  const { data: allowance = 0n } = useReadContract({
    ...USDC,
    functionName: 'allowance',
    args: [player, GAME.address],
    query: { enabled },
  });

  const [size, setSize] = useState<number>(1);
  const [slip, setSlip] = useState<Slip>([null]);
  const [selected, setSelected] = useState<number | undefined>(undefined);
  const [digits, setDigits] = useState('');
  const [savedRef, setSavedRef] = useState<string | null>(null);
  // One-time 18+ and terms confirmation before the first ticket (R-02).
  const [consented, setConsented] = useState(true);
  const tx = useTransactions();

  useEffect(() => setSavedRef(window.localStorage.getItem(REFERRAL_STORAGE_KEY)), []);
  useEffect(() => setConsented(readConsent(window.localStorage)), []);

  // The open draw's own per-wallet limit (the contract's `maxTicketsPerWallet`, C-12).
  const limit = walletLimitOf(current);
  const held = Number(alreadyBought);
  const bundles = availableBundles(held, limit);
  const remaining = Math.max(0, limit - held);
  // Keep the chosen bundle valid if the wallet limit shrinks.
  useEffect(() => {
    if (isConnected && !bundles.includes(size) && bundles.length > 0) {
      const fit = Math.max(...bundles);
      setSize(fit);
      setSlip((s) => resizeSlip(s, fit));
    }
  }, [bundles, isConnected, size]);

  // Price and fee come from the open draw itself (it copied the contract's params when it opened),
  // so the total shown and the USDC approved are what `buyTickets` pulls.
  const pricing = pricingOf(current);
  const cost = bundleCost(size, pricing);
  const referrer = address ? referrerForPurchase(savedRef, address, lastPlayed > 0n) : zeroAddress;
  const salesOpen = !!current && current.status === DrawStatus.Open && Number(current.cutoff) > now;
  const complete = isComplete(slip);
  const shortOfUsdc = balance !== undefined && balance < cost.total;

  const chooseSize = (n: number) => {
    setSize(n);
    setSlip((s) => resizeSlip(s, n));
    setSelected(undefined);
  };

  const press = (d: string) => {
    const next = digits + d;
    if (next.length < 2) {
      setDigits(next);
      return;
    }
    const value = Number(next);
    const placed = placeNumber(slip, value, selected);
    setSlip(placed);
    setDigits('');
    const nextEmpty = placed.indexOf(null);
    setSelected(nextEmpty >= 0 ? nextEmpty : undefined);
  };

  const buy = async () => {
    if (!complete || currentId === undefined || !current) return;
    // The contract would revert anyway; don't ask the wallet to sign a purchase over the limit.
    if (!withinLimit(held, size, walletLimitOf(current))) return;
    const numbers = slip as number[];
    const total = bundleCost(size, pricingOf(current)).total;
    const hash = await tx.run(async (step) => {
      if (allowance < total) {
        await step('Approving USDC', () =>
          writeContract(config, {
            ...USDC,
            functionName: 'approve',
            args: [GAME.address, total],
            chainId: appConfig.chain.id,
          }),
        );
      }
      const receipt = await step('Buying tickets', () =>
        writeContract(config, {
          ...GAME,
          functionName: 'buyTickets',
          args: [currentId, numbers, referrer],
          chainId: appConfig.chain.id,
        }),
      );
      return receipt.transactionHash;
    });
    if (hash) {
      onBought({ drawId: currentId, numbers, total, hash, cutoff: current.cutoff });
    }
  };

  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

  return (
    <>
      <p className="muted" style={{ margin: 0, fontSize: 14 }}>
        {currentId !== undefined ? `Draw #${currentId} · ` : ''}00 to 99
        {current ? ` · sales close ${formatWatTime(current.cutoff)}` : ''}
      </p>

      <section
        aria-label="How many tickets"
        style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
      >
        <span style={{ fontWeight: 600 }}>How many tickets?</span>
        <div className="chips" role="group" aria-label="Bundle size">
          {BUNDLES.map((n) => (
            <button
              key={n}
              type="button"
              className="chip"
              aria-pressed={size === n}
              disabled={isConnected && !bundles.includes(n)}
              onClick={() => chooseSize(n)}
            >
              {n}
            </button>
          ))}
        </div>
        {isConnected && (
          <span className="muted" style={{ fontSize: 13 }}>
            {remaining > 0
              ? `${limitLine(held, limit)} · ${remaining} more allowed.`
              : `${limitLine(held, limit)}: that's the limit. Come back for the next draw.`}
          </span>
        )}
      </section>

      <section
        aria-label="Your numbers"
        style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
      >
        <div className="section-head">
          <span style={{ fontWeight: 600 }}>Your numbers</span>
          <span style={{ display: 'flex', gap: 4 }}>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                setSlip(luckyDip(slip));
                setDigits('');
                setSelected(undefined);
              }}
            >
              Lucky dip
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                setSlip(resizeSlip([], size));
                setDigits('');
                setSelected(undefined);
              }}
            >
              Clear
            </button>
          </span>
        </div>
        <div className="slip" data-testid="slip">
          {slip.map((n, i) => (
            <button
              key={i}
              type="button"
              className={[
                'slot',
                n !== null ? 'slot-filled' : '',
                selected === i ? 'slot-selected' : '',
              ].join(' ')}
              aria-label={
                n === null ? `Ticket ${i + 1}: empty` : `Ticket ${i + 1}: ${num(n)}, tap to change`
              }
              onClick={() => setSelected(selected === i ? undefined : i)}
            >
              {n === null ? '··' : num(n)}
            </button>
          ))}
        </div>
      </section>

      <div className="entry" aria-live="polite" aria-label={`Typing ${digits || 'nothing'}`}>
        <div>{digits[0] ?? ''}</div>
        <div>{digits[1] ?? ''}</div>
      </div>

      <div className="keypad">
        {keys.map((k) => (
          <button key={k} type="button" className="key" onClick={() => press(k)}>
            {k}
          </button>
        ))}
        <button
          type="button"
          className="key key-text"
          onClick={() => setDigits('')}
          aria-label="Clear digits"
        >
          Clear
        </button>
        <button type="button" className="key" onClick={() => press('0')}>
          0
        </button>
        <button
          type="button"
          className="key key-text"
          onClick={() => setDigits(digits.slice(0, -1))}
          aria-label="Delete last digit"
        >
          ⌫
        </button>
      </div>

      <div className="summary">
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
          <span className="muted">
            {`${size} × ${formatUsdc(pricing.ticketPrice)} + ${formatFee(pricing.feeBps)} fee (${formatUsdc(cost.fee)})`}
          </span>
          <strong data-testid="total">{formatUsdc(cost.total)}</strong>
        </div>
        {referrer !== zeroAddress && (
          <span className="muted" style={{ fontSize: 13 }}>
            Invited by {shortAddress(referrer)}. They earn a share if you win.
          </span>
        )}
        <TxNotice state={tx.state} />
        {isConnected && <GasDripNotice address={address} />}
        {!isConnected ? (
          <ConnectPrompt label="Connect wallet to buy" />
        ) : !salesOpen ? (
          <Notice tone="warn">Sales for this draw have closed. The next draw opens shortly.</Notice>
        ) : shortOfUsdc ? (
          <>
            <Notice tone="warn">
              You need {formatUsdc(cost.total)} USDC; your wallet has {formatUsdc(balance ?? 0n)}.
            </Notice>
            {appConfig.faucet && (
              <Link href="/wallet" className="btn btn-secondary btn-block">
                Get test USDC
              </Link>
            )}
          </>
        ) : !consented ? (
          <AgeConfirm
            onConfirm={() => {
              saveConsent(window.localStorage);
              setConsented(true);
            }}
          />
        ) : (
          <button
            type="button"
            className="btn btn-gold btn-lg btn-block"
            disabled={!complete || tx.busy || wrongChain || !withinLimit(held, size, limit)}
            onClick={buy}
          >
            {!complete
              ? `Pick ${slip.filter((n) => n === null).length} more number${slip.filter((n) => n === null).length === 1 ? '' : 's'}`
              : allowance < cost.total
                ? `Approve and buy for ${formatUsdc(cost.total)}`
                : `Buy ${size} ticket${size === 1 ? '' : 's'} for ${formatUsdc(cost.total)}`}
          </button>
        )}
        {isConnected &&
          consented &&
          complete &&
          allowance < cost.total &&
          salesOpen &&
          !shortOfUsdc && (
            <span className="muted" style={{ fontSize: 12, textAlign: 'center' }}>
              Two steps in your wallet: allow the game to take {formatUsdc(cost.total)} USDC, then
              buy.
            </span>
          )}
      </div>
    </>
  );
}

/** Asked once per browser, before the first purchase. */
function AgeConfirm({ onConfirm }: { onConfirm: () => void }) {
  const [checked, setChecked] = useState(false);
  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 14 }}>
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => setChecked(e.target.checked)}
          style={{ marginTop: 3 }}
        />
        <span>
          I am 18 or older and I agree to the{' '}
          <Link href={TERMS_PATH} target="_blank">
            terms
          </Link>
          .
        </span>
      </label>
      <button
        type="button"
        className="btn btn-primary btn-block"
        disabled={!checked}
        onClick={onConfirm}
      >
        Continue
      </button>
    </div>
  );
}

function Confirmation({ bought, onAgain }: { bought: Bought; onAgain: () => void }) {
  const { address } = usePlayer();
  const { data: balance } = useUsdcBalance(address);
  const groups = useMemo(() => groupNumbers(bought.numbers), [bought.numbers]);
  return (
    <>
      <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 6 }}>
        <h2 className="page-title" style={{ fontSize: 24 }} data-testid="confirmation">
          You&apos;re in draw #{bought.drawId.toString()}
        </h2>
        <p className="muted" style={{ margin: 0 }}>
          The draw is at {formatWatTime(drawTime(bought.cutoff))} WAT. Come back to see the number.
        </p>
      </div>
      <section
        aria-label="Your tickets"
        className="card"
        style={{ display: 'flex', flexDirection: 'column', gap: 14 }}
      >
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {groups.map(({ number, count }) => (
            <span key={number} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <NumberBadge value={number} size="sm" />
              {count > 1 && <span className="muted">×{count}</span>}
            </span>
          ))}
        </div>
        <dl className="stats">
          <div>
            <dt>Tickets</dt>
            <dd>
              {bought.numbers.length} · {formatUsdc(bought.total)}
            </dd>
          </div>
          <div>
            <dt>Draw</dt>
            <dd>
              #{bought.drawId.toString()} · {formatWatDate(bought.cutoff)}
            </dd>
          </div>
          <div>
            <dt>Wallet now</dt>
            <dd>{balance !== undefined ? formatUsdc(balance) : '…'}</dd>
          </div>
          <div>
            <dt>Transaction</dt>
            <dd>
              {appConfig.chain.blockExplorers ? (
                <a
                  href={`${appConfig.chain.blockExplorers.default.url}/tx/${bought.hash}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {shortAddress(bought.hash)}
                </a>
              ) : (
                shortAddress(bought.hash)
              )}
            </dd>
          </div>
        </dl>
      </section>
      <Notice>
        <strong>Nobody can choose tonight&apos;s number.</strong> Sales close first, then the
        contract asks a randomness provider for the number and pays winners by the rules in its
        code.
        {appConfig.chainKey === 'anvil' && ' (Local demo: the operator triggers the number.)'}
      </Notice>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <button type="button" className="btn btn-secondary btn-block" onClick={onAgain}>
          Play more numbers
        </button>
        <Link href="/" className="btn btn-primary btn-block">
          Done
        </Link>
      </div>
    </>
  );
}
