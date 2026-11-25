'use client';

import { formatUsdc } from '@daily-draw/shared';
import Link from 'next/link';
import { AppShell } from '../../components/AppShell';
import { Icon, NumberBadge, num } from '../../components/ui';
import {
  DrawStatus,
  numbersInDraw,
  useGame,
  usePlayer,
  usePrize,
  usePurchases,
  useRecentDraws,
  type Draw,
  type Purchase,
} from '../../lib/game';
import { groupNumbers } from '../../lib/tickets';
import { formatWatDate } from '../../lib/time';

export default function ResultsPage() {
  const { currentId } = useGame();
  const draws = useRecentDraws(currentId);
  const { address } = usePlayer();
  const purchases = usePurchases(address);

  return (
    <AppShell>
      <h1 className="page-title">Results</h1>
      {draws.isLoading || currentId === undefined ? (
        <p className="muted">Loading…</p>
      ) : (draws.data ?? []).length === 0 ? (
        <div className="card muted">
          No draws yet. The first draw closes at 8:45pm WAT, and its number arrives at 9:00pm.
        </div>
      ) : (
        <section aria-label="Past draws" className="list" data-testid="past-draws">
          {draws.data!.map(({ id, draw }) => (
            <DrawRow key={id.toString()} id={id} draw={draw} purchases={purchases.data} />
          ))}
        </section>
      )}
    </AppShell>
  );
}

function summary(draw: Draw): string {
  switch (draw.status) {
    case DrawStatus.Closed:
      return 'Sales closed · number on its way';
    case DrawStatus.Voided:
      return 'Cancelled · tickets refundable';
    case DrawStatus.Settled:
    case DrawStatus.Swept:
      return draw.winningTickets === 0
        ? `No winner · ${formatUsdc(draw.pool)} rolled over`
        : `${draw.winningTickets} winning ticket${draw.winningTickets === 1 ? '' : 's'} · ${formatUsdc(draw.prizePerTicket)} each`;
    default:
      return '';
  }
}

function DrawRow({
  id,
  draw,
  purchases,
}: {
  id: bigint;
  draw: Draw;
  purchases: Purchase[] | undefined;
}) {
  const { address } = usePlayer();
  const prize = usePrize(id, address);
  const mine = numbersInDraw(purchases, id);
  const hasNumber = draw.status === DrawStatus.Settled || draw.status === DrawStatus.Swept;
  return (
    <div className="list-row" style={{ alignItems: 'flex-start' }}>
      <Link
        href={`/draw/${id}`}
        style={{
          display: 'flex',
          flex: 1,
          gap: 14,
          minWidth: 0,
          color: 'inherit',
          textDecoration: 'none',
        }}
      >
        {hasNumber ? (
          <NumberBadge value={draw.winningNumber} size="sm" />
        ) : (
          <span className="num num-sm" aria-hidden="true">
            ··
          </span>
        )}
        <span style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
          <span style={{ fontWeight: 600, fontSize: 15 }}>
            {formatWatDate(draw.cutoff)} · #{id.toString()}
          </span>
          <span className="muted" style={{ fontSize: 13 }}>
            {summary(draw)}
          </span>
          {mine.length > 0 && (
            <span style={{ fontSize: 13 }}>
              Your tickets:{' '}
              {groupNumbers(mine)
                .map(({ number, count }) => `${num(number)}${count > 1 ? ` ×${count}` : ''}`)
                .join(', ')}
            </span>
          )}
        </span>
        {prize.tickets > 0n && !prize.claimed ? (
          <span
            className="pill pill-gold"
            style={{ background: 'var(--gold)', color: 'var(--ink)' }}
          >
            Claim {formatUsdc(prize.prize)}
          </span>
        ) : prize.claimed ? (
          <span className="pill pill-green">Claimed</span>
        ) : null}
      </Link>
      {hasNumber && (
        <Link
          href={`/verify/${id}`}
          className="pill pill-grey"
          style={{ textDecoration: 'none' }}
          aria-label={`Verify draw #${id}`}
        >
          <Icon name="check" size={14} /> Verify
        </Link>
      )}
    </div>
  );
}
