'use client';

import { formatUsdc } from '@daily-draw/shared';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { zeroAddress } from 'viem';
import { useConfig, useReadContract } from 'wagmi';
import { writeContract } from 'wagmi/actions';
import { useMounted } from '../../../components/AppShell';
import { Icon, NumberBadge, TxNotice, num } from '../../../components/ui';
import { ConnectPrompt } from '../../../components/Wallet';
import { appConfig } from '../../../lib/config';
import {
  DrawStatus,
  GAME,
  numbersInDraw,
  useDraw,
  usePlayer,
  usePrize,
  usePurchases,
  useTransactions,
  type Draw,
} from '../../../lib/game';
import { groupNumbers } from '../../../lib/tickets';
import { drawTime, formatWatDate, formatWatTime } from '../../../lib/time';

/** The 9pm reveal for one draw, then the player's result and Claim (or Refund) button. */
export default function DrawPage() {
  const params = useParams<{ id: string }>();
  const mounted = useMounted();
  const drawId = /^\d+$/.test(params.id) ? BigInt(params.id) : undefined;
  const { data: draw } = useDraw(drawId);

  return (
    <div className="night-page">
      <div className="shell" style={{ minHeight: '100dvh' }}>
        <header className="topbar">
          <Link href="/" className="btn btn-ghost-light" aria-label="Close" style={{ padding: 0 }}>
            <Icon name="close" color="#fff" />
          </Link>
          {draw && draw.status !== DrawStatus.Open && (
            <span className="pill pill-gold">
              {draw.status === DrawStatus.Closed ? 'LIVE' : 'Draw'} ·{' '}
              {formatWatTime(drawTime(draw.cutoff))}
            </span>
          )}
          <span style={{ width: 44 }} />
        </header>
        <main className="content" style={{ alignItems: 'stretch', gap: 20 }}>
          {!mounted || drawId === undefined || !draw ? (
            <p style={{ color: 'var(--night-text)', textAlign: 'center' }}>
              {drawId === undefined ? 'No such draw.' : 'Loading…'}
            </p>
          ) : (
            <DrawView drawId={drawId} draw={draw} />
          )}
        </main>
      </div>
    </div>
  );
}

const SEEN_KEY = (id: bigint) => `dailydraw.revealed.${appConfig.chain.id}.${id}`;

/** The line under the digits: the draw's state, or how far the reveal animation has got. */
function statusMessage(draw: Draw, phase: 0 | 1 | 2, target: string): string {
  switch (draw.status) {
    case DrawStatus.Open:
      return `Sales are open until ${formatWatTime(draw.cutoff)} WAT. The draw is at ${formatWatTime(drawTime(draw.cutoff))}.`;
    case DrawStatus.Closed:
      return 'Sales closed. Waiting for the random number…';
    case DrawStatus.Voided:
      return 'This draw was cancelled because no random number arrived. Every ticket can be refunded in full.';
  }
  // Drawn, settled or swept: follow the reveal animation.
  switch (phase) {
    case 0:
      return 'Drawing…';
    case 1:
      return 'First digit…';
    case 2:
      return `The number is ${target}`;
  }
}

function DrawView({ drawId, draw }: { drawId: bigint; draw: Draw }) {
  const settled = draw.status === DrawStatus.Settled || draw.status === DrawStatus.Swept;
  const [phase, setPhase] = useState<0 | 1 | 2>(2);
  const [digits, setDigits] = useState<[string, string]>(['·', '·']);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const spinner = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const phaseRef = useRef<0 | 1 | 2>(2);
  const target = settled ? num(draw.winningNumber) : '··';

  const stop = () => {
    timers.current.forEach((t) => clearTimeout(t));
    timers.current = [];
    clearInterval(spinner.current);
  };

  const play = useCallback(() => {
    stop();
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) {
      setDigits([target[0]!, target[1]!]);
      setPhase(2);
      return;
    }
    setPhase(0);
    const rnd = () => String(Math.floor(Math.random() * 10));
    phaseRef.current = 0;
    spinner.current = setInterval(() => {
      setDigits((d) => [phaseRef.current === 0 ? rnd() : d[0], rnd()]);
    }, 70);
    timers.current.push(
      setTimeout(() => {
        phaseRef.current = 1;
        setPhase(1);
        setDigits((d) => [target[0]!, d[1]]);
      }, 1800),
      setTimeout(() => {
        clearInterval(spinner.current);
        sessionStorage.setItem(SEEN_KEY(drawId), '1');
        phaseRef.current = 2;
        setPhase(2);
        setDigits([target[0]!, target[1]!]);
      }, 3400),
    );
  }, [target, drawId]);

  // Waiting for the number: keep the digits rolling. Once it lands, reveal it once per device.
  useEffect(() => {
    if (draw.status === DrawStatus.Closed) {
      const rnd = () => String(Math.floor(Math.random() * 10));
      const spin = setInterval(() => setDigits([rnd(), rnd()]), 90);
      setPhase(0);
      return () => clearInterval(spin);
    }
    if (settled) {
      if (sessionStorage.getItem(SEEN_KEY(drawId))) {
        setDigits([target[0]!, target[1]!]);
        setPhase(2);
      } else {
        play();
      }
    }
    return stop;
  }, [draw.status, settled, drawId, target, play]);

  const done = settled && phase === 2;
  const status = statusMessage(draw, phase, target);

  return (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
        <span style={{ color: 'var(--night-text)', fontSize: 14 }}>
          Draw #{drawId.toString()} · {formatWatDate(draw.cutoff)}
        </span>
        <span style={{ color: 'var(--night-text)', fontSize: 13 }}>Pool</span>
        <span className="display" style={{ fontSize: 36, fontWeight: 700 }}>
          {formatUsdc(settled ? draw.pool : draw.sales)}
        </span>
      </div>

      {draw.status !== DrawStatus.Open && draw.status !== DrawStatus.Voided && (
        <div
          className="reveal-digits"
          aria-live="polite"
          aria-label={done ? `Winning number ${target}` : 'Drawing'}
          data-testid="reveal"
        >
          <div className="reveal-digit" data-locked={phase >= 1 && settled}>
            {digits[0]}
          </div>
          <div className="reveal-digit" data-locked={phase === 2 && settled}>
            {digits[1]}
          </div>
        </div>
      )}
      <p
        style={{ textAlign: 'center', margin: 0, color: 'var(--night-text)' }}
        data-testid="reveal-status"
      >
        {status}
      </p>

      {done && (
        <dl
          className="stats"
          style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', textAlign: 'center' }}
        >
          <div>
            <dt style={{ color: 'var(--night-text)' }}>Winning tickets</dt>
            <dd>{draw.winningTickets}</dd>
          </div>
          <div>
            <dt style={{ color: 'var(--night-text)' }}>Each wins</dt>
            <dd>{draw.winningTickets ? formatUsdc(draw.prizePerTicket) : '–'}</dd>
          </div>
          <div>
            <dt style={{ color: 'var(--night-text)' }}>Tickets</dt>
            <dd>{draw.ticketCount}</dd>
          </div>
        </dl>
      )}
      {done && draw.winningTickets === 0 && (
        <p style={{ textAlign: 'center', margin: 0, color: 'var(--gold)' }}>
          No winner tonight. The whole pool rolls over to the next draw.
        </p>
      )}

      {(done || draw.status === DrawStatus.Voided || draw.status === DrawStatus.Open) && (
        <PlayerResult drawId={drawId} draw={draw} />
      )}

      <div style={{ display: 'flex', justifyContent: 'center', gap: 8 }}>
        {settled && (
          <button type="button" className="btn btn-ghost-light" onClick={play}>
            Watch again
          </button>
        )}
        {done && (
          <Link
            href={`/verify/${drawId}`}
            className="btn btn-ghost-light"
            data-testid="verify-link"
          >
            Verify this draw
          </Link>
        )}
        <Link href="/results" className="btn btn-ghost-light">
          All results
        </Link>
      </div>
      {settled && (
        <p style={{ fontSize: 12, color: 'var(--night-text)', textAlign: 'center', margin: 0 }}>
          The animation is just for show. The number was fixed when the random value reached the
          contract, which settled the pool in the same transaction. Verify this draw to redo the
          maths yourself.
        </p>
      )}
    </>
  );
}

/** The connected player's tickets in this draw, with Claim (won) or Refund (cancelled). */
function PlayerResult({ drawId, draw }: { drawId: bigint; draw: Draw }) {
  const config = useConfig();
  const { address, isConnected, wrongChain } = usePlayer();
  const purchases = usePurchases(address);
  const prize = usePrize(drawId, address);
  const tx = useTransactions();
  const mine = numbersInDraw(purchases.data, drawId);
  const settled = draw.status === DrawStatus.Settled;
  const won = settled && mine.includes(draw.winningNumber);
  const { data: refunded } = useReadContract({
    ...GAME,
    functionName: 'refunded',
    args: [drawId, address ?? zeroAddress, BigInt(mine[0] ?? 0)],
    query: { enabled: draw.status === DrawStatus.Voided && !!address && mine.length > 0 },
  });

  if (!isConnected) {
    return <ConnectPrompt label="Connect wallet to see your tickets" />;
  }
  if (purchases.isLoading) return null;
  if (mine.length === 0) {
    return (
      <p style={{ textAlign: 'center', color: 'var(--night-text)', margin: 0 }}>
        You had no tickets in this draw.
      </p>
    );
  }

  const unique = [...new Set(mine)];
  const claim = () =>
    tx.run(async (step) => {
      const r = await step('Claiming your prize', () =>
        writeContract(config, {
          ...GAME,
          functionName: 'claim',
          args: [drawId, unique],
          chainId: appConfig.chain.id,
        }),
      );
      return r.transactionHash;
    });
  const refund = () =>
    tx.run(async (step) => {
      const r = await step('Refunding your tickets', () =>
        writeContract(config, {
          ...GAME,
          functionName: 'refund',
          args: [drawId, unique],
          chainId: appConfig.chain.id,
        }),
      );
      return r.transactionHash;
    });

  return (
    <section
      aria-label="Your result"
      className={won ? 'win-hero' : 'card'}
      style={
        won ? { background: 'rgba(255,255,255,0.06)', border: '1px solid var(--gold)' } : undefined
      }
      data-testid={won ? 'win' : 'your-tickets'}
    >
      {won ? (
        <>
          <NumberBadge value={draw.winningNumber} size="lg" win />
          <h2 style={{ margin: 0, fontSize: 22 }}>Your number came out!</h2>
          <div className="win-amount">
            {formatUsdc(
              prize.claimed
                ? draw.prizePerTicket * BigInt(mine.filter((n) => n === draw.winningNumber).length)
                : prize.prize,
            )}
          </div>
          <p style={{ margin: 0, color: 'var(--night-text)', fontSize: 14 }}>
            {mine.filter((n) => n === draw.winningNumber).length} ticket
            {mine.filter((n) => n === draw.winningNumber).length === 1 ? '' : 's'} on{' '}
            {num(draw.winningNumber)} · Draw #{drawId.toString()}
          </p>
          {prize.claimed ? (
            <span className="pill pill-green">
              <Icon name="check" size={16} /> Claimed to your wallet
            </span>
          ) : (
            <button
              type="button"
              className="btn btn-gold btn-lg btn-block"
              disabled={tx.busy || wrongChain}
              onClick={claim}
            >
              Claim {formatUsdc(prize.prize)}
            </button>
          )}
          <TxNotice state={tx.state} />
          {!prize.claimed && (
            <p style={{ margin: 0, color: 'var(--night-text)', fontSize: 13 }}>
              Claim within 30 days. After that, unclaimed prizes go back into the pool.
            </p>
          )}
        </>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, color: 'var(--ink)' }}>
          <span style={{ fontWeight: 600 }}>Your tickets</span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {groupNumbers(mine).map(({ number, count }) => (
              <span key={number} className="pill pill-grey" style={{ fontSize: 15 }}>
                {num(number)}
                {count > 1 ? ` ×${count}` : ''}
              </span>
            ))}
          </div>
          {settled && (
            <span className="muted" style={{ fontSize: 14 }}>
              Not this time. Thanks for playing.
            </span>
          )}
          {draw.status === DrawStatus.Voided && refunded && (
            <span className="pill pill-green" style={{ alignSelf: 'flex-start' }}>
              <Icon name="check" size={16} /> Refunded to your wallet
            </span>
          )}
          {draw.status === DrawStatus.Voided && !refunded && (
            <>
              <button
                type="button"
                className="btn btn-primary btn-block"
                disabled={tx.busy || wrongChain}
                onClick={refund}
              >
                Refund my tickets
              </button>
              <TxNotice state={tx.state} />
            </>
          )}
        </div>
      )}
    </section>
  );
}
