'use client';

import { formatUsdc } from '@daily-draw/shared';
import Link from 'next/link';
import { AppShell } from '../components/AppShell';
import { NumberBadge, num } from '../components/ui';
import { ConnectPrompt } from '../components/Wallet';
import {
  DrawStatus,
  numbersInDraw,
  useChainNow,
  useGame,
  usePlayer,
  usePrize,
  usePurchases,
  type Draw,
} from '../lib/game';
import { bundleCost, groupNumbers } from '../lib/tickets';
import { drawTime, formatCountdown, formatWatTime } from '../lib/time';

export default function Home() {
  const { currentId, current, previous, rollover } = useGame();
  const { address, isConnected } = usePlayer();
  const now = useChainNow();
  const purchases = usePurchases(address);

  return (
    <AppShell>
      {current && currentId !== undefined ? (
        <TonightCard draw={current} drawId={currentId} rollover={rollover ?? 0n} now={now} />
      ) : (
        <section className="hero" aria-busy="true">
          <span className="sub">Tonight&apos;s pool so far</span>
          <span className="hero-amount">…</span>
        </section>
      )}

      {previous && currentId !== undefined && (
        <LastResult draw={previous} drawId={currentId - 1n} />
      )}

      <section
        aria-label="My tickets tonight"
        style={{ display: 'flex', flexDirection: 'column', gap: 10 }}
      >
        <div className="section-head">
          <h2>My tickets tonight</h2>
          {isConnected && (
            <Link href="/results" className="link">
              All tickets
            </Link>
          )}
        </div>
        {!isConnected ? (
          <ConnectPrompt label="Connect wallet to play" />
        ) : currentId === undefined || purchases.isLoading ? (
          <p className="muted">Loading…</p>
        ) : (
          <MyTickets numbers={numbersInDraw(purchases.data, currentId)} />
        )}
      </section>

      <p className="muted" style={{ margin: 0, fontSize: 13, textAlign: 'center' }}>
        Play for fun, not for income. 18+ only.
      </p>
    </AppShell>
  );
}

function TonightCard({
  draw,
  drawId,
  rollover,
  now,
}: {
  draw: Draw;
  drawId: bigint;
  rollover: bigint;
  now: number;
}) {
  const left = Number(draw.cutoff) - now;
  const open = draw.status === DrawStatus.Open && left > 0;
  const withFee = bundleCost(1).total;
  return (
    <section className="hero" aria-label="Tonight's draw">
      <div
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}
      >
        <span className="sub" style={{ fontWeight: 500 }}>
          Draw #{drawId.toString()} pool so far
        </span>
        <span className="pill pill-gold" data-testid="countdown">
          {open ? formatCountdown(left) : 'Sales closed'}
        </span>
      </div>
      <div className="hero-amount" data-testid="pool">
        {formatUsdc(draw.sales + rollover)}
      </div>
      <div className="sub">
        {draw.ticketCount.toLocaleString()} tickets · Sales close {formatWatTime(draw.cutoff)} ·
        Draw {formatWatTime(drawTime(draw.cutoff))} WAT
      </div>
      {rollover > 0n && (
        <div className="sub">Includes {formatUsdc(rollover)} rolled over from earlier draws.</div>
      )}
      {open ? (
        <Link href="/play" className="btn btn-gold btn-lg btn-block">
          Play for {formatUsdc(withFee)}
        </Link>
      ) : (
        <span className="btn btn-gold btn-lg btn-block" aria-disabled="true">
          Sales closed. Draw at {formatWatTime(drawTime(draw.cutoff))}
        </span>
      )}
      <span className="sub" style={{ textAlign: 'center', fontSize: 13 }}>
        $1 a ticket + 10% fee · winners share 65% of the pool
      </span>
    </section>
  );
}

function LastResult({ draw, drawId }: { draw: Draw; drawId: bigint }) {
  const { address } = usePlayer();
  const prize = usePrize(drawId, address);
  const settled = draw.status === DrawStatus.Settled || draw.status === DrawStatus.Swept;

  if (draw.status === DrawStatus.Closed) {
    return (
      <Link
        href={`/draw/${drawId}`}
        className="card"
        style={{ textDecoration: 'none', color: 'inherit' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <span className="num" aria-hidden="true">
            ··
          </span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span className="muted" style={{ fontSize: 13 }}>
              Draw #{drawId.toString()} · {draw.ticketCount} tickets
            </span>
            <span style={{ fontWeight: 600 }}>Sales closed. The number is on its way.</span>
            <span style={{ color: 'var(--brand)', fontWeight: 600, fontSize: 14 }}>
              Watch the draw live
            </span>
          </div>
        </div>
      </Link>
    );
  }
  if (!settled) return null;

  return (
    <>
      {prize.tickets > 0n && !prize.claimed && (
        <Link
          href={`/draw/${drawId}`}
          className="btn btn-gold btn-lg btn-block"
          data-testid="claim-banner"
        >
          You won {formatUsdc(prize.prize)}. Claim it
        </Link>
      )}
      <section
        aria-label="Last result"
        className="card"
        style={{ display: 'flex', alignItems: 'center', gap: 16 }}
      >
        <NumberBadge value={draw.winningNumber} size="lg" />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span className="muted" style={{ fontSize: 13 }}>
            Last number · Draw #{drawId.toString()}
          </span>
          <span style={{ fontWeight: 600, fontSize: 15 }}>
            {draw.winningTickets === 0
              ? `No winner · ${formatUsdc(draw.pool)} rolled over`
              : `${draw.winningTickets} winning ticket${draw.winningTickets === 1 ? '' : 's'} · ${formatUsdc(draw.prizePerTicket)} each`}
          </span>
          <Link href={`/draw/${drawId}`} className="link" style={{ alignSelf: 'flex-start' }}>
            See the draw
          </Link>
        </div>
      </section>
    </>
  );
}

function MyTickets({ numbers }: { numbers: number[] }) {
  if (numbers.length === 0) {
    return (
      <div className="card muted" style={{ fontSize: 14 }}>
        No tickets in tonight&apos;s draw yet.{' '}
        <Link href="/play" className="link">
          Pick a number
        </Link>
      </div>
    );
  }
  const price = bundleCost(1).total;
  return (
    <div className="list" data-testid="my-tickets">
      {groupNumbers(numbers).map(({ number, count }) => (
        <div className="list-row" key={number}>
          <span className="display" style={{ fontWeight: 700, fontSize: 22, width: 36 }}>
            {num(number)}
          </span>
          <span className="muted" style={{ flex: 1, fontSize: 14 }}>
            {count} ticket{count === 1 ? '' : 's'}
          </span>
          <span style={{ fontWeight: 600, fontSize: 14 }}>{formatUsdc(price * BigInt(count))}</span>
        </div>
      ))}
    </div>
  );
}
