import { loadSnapshot, type Snapshot } from '../lib/chain';
import { parseAdminConfig, type AdminConfig } from '../lib/config';
import {
  duration,
  obligations,
  openDrawFigures,
  playerStats,
  settlement,
  solvency,
  Status,
  STATUS_NAMES,
  sweepSchedule,
  ticketsPerNumber,
  type DrawParams,
  type NumberedDraw,
} from '../lib/figures';
import { healthChecks } from '../lib/health';
import { number2, percent, token18, usd, watDate, watDateTime } from '../lib/format';
import { Addr, Badge, Empty, Section, Stat, Stats } from './ui';

// Always read fresh figures from the chain.
export const dynamic = 'force-dynamic';

const REFRESH_SECONDS = 60;

export default async function Dashboard() {
  let config: AdminConfig;
  let snapshot: Snapshot;
  try {
    config = parseAdminConfig(process.env);
  } catch (err) {
    return <Problem title="Configuration" message={(err as Error).message} />;
  }
  try {
    snapshot = await loadSnapshot(config);
  } catch (err) {
    const e = err as Error & { shortMessage?: string };
    return <Problem title="Could not read the chain" message={e.shortMessage ?? e.message} />;
  }
  const explorer = config.chain.blockExplorers?.default.url ?? null;
  const s = snapshot;

  return (
    <main className="page">
      <meta httpEquiv="refresh" content={String(REFRESH_SECONDS)} />
      <header className="top">
        <div>
          <h1>Daily Draw admin</h1>
          <div className="muted small">
            Read-only · {config.chain.name} · game{' '}
            <Addr address={config.dailyDraw} explorer={explorer} /> · block{' '}
            {s.blockNumber.toString()} · chain time {watDateTime(s.now)} WAT · refreshes every{' '}
            {REFRESH_SECONDS}s
          </div>
        </div>
      </header>

      <Health s={s} config={config} explorer={explorer} />
      <Today s={s} />
      <Money s={s} config={config} explorer={explorer} />
      <PastDraws s={s} />
      <Settings s={s} explorer={explorer} />
      <Players s={s} explorer={explorer} />

      <footer className="muted small footer">
        Figures come straight from the contract and its events
        {config.deployment ? ` (defaults from deployments/${config.deployment}.json)` : ''}, scanned
        from block {config.startBlock.toString()} via {new URL(config.rpcUrl).host}. Changes to
        money or settings go through the Admin wallet and the timelock, never this page. Naira
        ledger figures arrive in R3.
      </footer>
    </main>
  );
}

function Problem({ title, message }: { title: string; message: string }) {
  return (
    <main className="page">
      <h1>Daily Draw admin</h1>
      <div className="check check-alert">
        <strong>{title}</strong>
        <div>{message}</div>
      </div>
      <p className="muted small">See apps/admin/README.md for the environment variables.</p>
    </main>
  );
}

// ---------------------------------------------------------------------------------------------

function Health({
  s,
  config,
  explorer,
}: {
  s: Snapshot;
  config: AdminConfig;
  explorer: string | null;
}) {
  const checks = healthChecks(s, config.thresholds, config.chain.nativeCurrency.symbol);
  const alerts = checks.filter((c) => c.level === 'alert').length;
  const warnings = checks.filter((c) => c.level === 'warn').length;
  return (
    <Section
      title="Health"
      note={
        alerts + warnings === 0
          ? 'All good'
          : `${alerts} alert${alerts === 1 ? '' : 's'}, ${warnings} warning${warnings === 1 ? '' : 's'}`
      }
    >
      <ul className="checks">
        {checks.map((c, i) => (
          <li key={i} className={`check check-${c.level}`}>
            <Badge level={c.level}>
              {c.level === 'ok' ? 'OK' : c.level === 'warn' ? 'Warn' : 'Alert'}
            </Badge>
            <div>
              <strong>{c.title}</strong>
              <div className="small">{c.detail}</div>
            </div>
          </li>
        ))}
      </ul>
      <p className="muted small" style={{ marginBottom: 0 }}>
        Keeper:{' '}
        {s.keeper ? <Addr address={s.keeper.address} explorer={explorer} /> : 'not configured'}
        {s.keeper?.wei != null ? ` · ${token18(s.keeper.wei, 'ETH')}` : ''}
        {s.drip ? (
          <>
            {' '}
            · Drip wallet: <Addr address={s.drip.address} explorer={explorer} />
            {s.drip.wei != null ? ` · ${token18(s.drip.wei, 'ETH')}` : ''}
          </>
        ) : null}
      </p>
    </Section>
  );
}

function Today({ s }: { s: Snapshot }) {
  const current = s.draws.find((d) => d.id === s.currentDrawId);
  if (!current) return null;
  const { draw } = current;
  const f = openDrawFigures(draw, s.balances.rollover, s.now);
  const counts = ticketsPerNumber(s.purchases, current.id, draw.params.numberRange);
  const max = Math.max(1, ...counts);
  const buyers = new Set(
    s.purchases.filter((p) => p.drawId === current.id).map((p) => p.player.toLowerCase()),
  ).size;
  return (
    <Section
      title={`Today's draw · #${current.id}`}
      note={`Sales close ${watDateTime(draw.cutoff)} WAT`}
    >
      <Stats>
        <Stat label="Status" value={STATUS_NAMES[draw.status]} />
        <Stat
          label="Time to cutoff"
          value={f.secondsToCutoff > 0 ? duration(f.secondsToCutoff) : 'Passed'}
          tone={f.secondsToCutoff > 0 ? undefined : 'warn'}
        />
        <Stat
          label="Tickets"
          value={f.tickets}
          hint={`${buyers} player${buyers === 1 ? '' : 's'}`}
        />
        <Stat label="Sales" value={usd(f.sales)} />
        <Stat label="Fees" value={usd(f.fees)} hint={`${percent(draw.params.feeBps)} per ticket`} />
        <Stat
          label="Pool"
          value={usd(f.pool)}
          hint={`incl. ${usd(f.rollover)} rollover brought in`}
        />
      </Stats>
      <h3>Tickets per number</h3>
      <div className="grid" style={{ gridTemplateColumns: `repeat(10, 1fr)` }}>
        {counts.map((n, i) => (
          <div
            key={i}
            className="cell"
            title={`${number2(i)}: ${n} ticket${n === 1 ? '' : 's'}`}
            style={{
              background: n ? `rgba(10, 107, 72, ${0.12 + (0.78 * n) / max})` : undefined,
              color: n / max > 0.55 ? '#fff' : undefined,
            }}
          >
            <div className="cell-number">{number2(i)}</div>
            <div className="cell-count">{n || '·'}</div>
          </div>
        ))}
      </div>
    </Section>
  );
}

function Money({
  s,
  config,
  explorer,
}: {
  s: Snapshot;
  config: AdminConfig;
  explorer: string | null;
}) {
  const o = obligations(s.draws, s.balances);
  const cover = solvency(s.usdcHeld, o.total);
  const sweeps = sweepSchedule(s.draws, s.now, config.thresholds.sweepWarnDays);
  const rows: [string, bigint, string][] = [
    ['Unsettled draws (sales + fees)', o.unsettledDraws, 'Open or awaiting randomness'],
    ['Rollover', o.rollover, 'Joins the next pool that settles'],
    ['Unclaimed prizes + their referral shares', o.unclaimedWinnings, 'Until claimed or swept'],
    ['Referral balances', o.referralBalances, 'Credited, not yet withdrawn'],
    ['Treasury balance', o.treasury, 'Team 10% + fees + unearned referral shares'],
    ['Buy-back balance', o.buyback, '5% of won pools'],
    ['Refunds owed (voided draws)', o.refundsOwed, 'Price + fee not yet refunded'],
  ];
  return (
    <Section title="Money" note="USDC">
      <Stats>
        <Stat label="Contract holds" value={usd(cover.held)} />
        <Stat label="Contract owes" value={usd(cover.owed)} />
        <Stat
          label={cover.covered ? 'Covered' : 'Short'}
          value={usd(cover.surplus < 0n ? -cover.surplus : cover.surplus)}
          hint={cover.covered ? 'held − owed (should be 0 or more)' : 'held is less than owed'}
          tone={cover.covered ? 'ok' : 'alert'}
        />
        <Stat
          label="Treasury to withdraw"
          value={usd(s.balances.treasuryBalance)}
          hint={
            <>
              to <Addr address={s.treasury} explorer={explorer} />
            </>
          }
        />
        <Stat
          label="Buy-back to withdraw"
          value={usd(s.balances.buybackBalance)}
          hint={
            <>
              to <Addr address={s.buybackReserve} explorer={explorer} />
            </>
          }
        />
      </Stats>
      <table>
        <thead>
          <tr>
            <th>Owed</th>
            <th className="num">Amount</th>
            <th>Notes</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, amount, note]) => (
            <tr key={label}>
              <td>{label}</td>
              <td className="num">{usd(amount)}</td>
              <td className="muted small">{note}</td>
            </tr>
          ))}
          <tr className="total">
            <td>Total owed</td>
            <td className="num">{usd(o.total)}</td>
            <td className="muted small">
              USDC <Addr address={s.usdc} explorer={explorer} />
            </td>
          </tr>
        </tbody>
      </table>
      <h3>Unclaimed prizes and the 30-day sweep</h3>
      {sweeps.length === 0 ? (
        <Empty>No settled draw has unclaimed prizes.</Empty>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Draw</th>
              <th className="num">Unclaimed tickets</th>
              <th className="num">Amount</th>
              <th>Sweepable from</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {sweeps.map((w) => (
              <tr key={w.id.toString()}>
                <td>#{w.id.toString()}</td>
                <td className="num">{w.unclaimedTickets}</td>
                <td className="num">{usd(w.unclaimedAmount)}</td>
                <td>{watDateTime(w.sweepableAt)}</td>
                <td>
                  {w.state === 'due' ? (
                    <Badge level="warn">Sweepable now</Badge>
                  ) : w.state === 'soon' ? (
                    <Badge level="warn">{w.daysLeft}d left</Badge>
                  ) : (
                    <span className="muted small">{w.daysLeft}d left</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Section>
  );
}

function PastDraws({ s }: { s: Snapshot }) {
  const past: NumberedDraw[] = s.draws.filter((d) => d.id !== s.currentDrawId).reverse();
  return (
    <Section title="Past draws" note={`${past.length} draw${past.length === 1 ? '' : 's'}`}>
      {past.length === 0 ? (
        <Empty>No draw has closed yet.</Empty>
      ) : (
        <div className="scroll">
          <table>
            <thead>
              <tr>
                <th>Draw</th>
                <th>Status</th>
                <th className="num">Tickets</th>
                <th className="num">Sales</th>
                <th className="num">Fees</th>
                <th className="num">Rollover in</th>
                <th className="num">Pool</th>
                <th className="num">Number</th>
                <th className="num">Winners</th>
                <th className="num">Prize / ticket</th>
                <th className="num">Referral / ticket</th>
                <th className="num">Team</th>
                <th className="num">Buy-back</th>
                <th className="num">Rollover out</th>
                <th className="num">Claimed</th>
              </tr>
            </thead>
            <tbody>
              {past.map(({ id, draw }) => {
                const st = settlement(draw);
                const level =
                  draw.status === Status.Settled || draw.status === Status.Swept
                    ? 'neutral'
                    : draw.status === Status.Voided
                      ? 'warn'
                      : 'alert';
                return (
                  <tr key={id.toString()}>
                    <td>
                      #{id.toString()} <span className="muted small">{watDate(draw.cutoff)}</span>
                    </td>
                    <td>
                      <Badge level={level}>{STATUS_NAMES[draw.status]}</Badge>
                      {draw.status === Status.Voided ? (
                        <div className="muted small">refunded {usd(draw.refunded)}</div>
                      ) : null}
                    </td>
                    <td className="num">{draw.ticketCount}</td>
                    <td className="num">{usd(draw.sales)}</td>
                    <td className="num">{usd(draw.fees)}</td>
                    <td className="num">{st ? usd(st.rolloverIn) : '—'}</td>
                    <td className="num">{st ? usd(st.pool) : '—'}</td>
                    <td className="num">{st ? number2(draw.winningNumber) : '—'}</td>
                    <td className="num">{st ? st.winners : '—'}</td>
                    <td className="num">{st && st.winners ? usd(st.prizePerTicket) : '—'}</td>
                    <td className="num">
                      {st && st.winners ? usd(st.referralSharePerTicket) : '—'}
                    </td>
                    <td className="num">{st ? usd(st.team) : '—'}</td>
                    <td className="num">{st ? usd(st.buyback) : '—'}</td>
                    <td className="num">{st ? usd(st.rolloverOut) : '—'}</td>
                    <td className="num">
                      {st && st.winners ? `${draw.claimedTickets}/${st.winners}` : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}

function ParamsList({ p }: { p: DrawParams }) {
  return (
    <dl className="params">
      <dt>Ticket price</dt>
      <dd>{usd(p.ticketPrice)}</dd>
      <dt>Fee</dt>
      <dd>{percent(p.feeBps)} on top</dd>
      <dt>Split</dt>
      <dd>
        winners {percent(p.winnersBps)} · team {percent(p.teamBps)} · buy-back{' '}
        {percent(p.buybackBps)} · referrers {percent(p.referrersBps)}
      </dd>
      <dt>Numbers</dt>
      <dd>00–{number2(p.numberRange - 1)}</dd>
      <dt>Max tickets</dt>
      <dd>{p.maxTicketsPerWallet} per wallet per draw</dd>
      <dt>Draw interval</dt>
      <dd>{duration(p.drawInterval)}</dd>
      <dt>Referrer active</dt>
      <dd>played within {p.referrerActiveDays} days</dd>
      <dt>Claim window</dt>
      <dd>{p.unclaimedPrizeDays} days, then swept</dd>
    </dl>
  );
}

function Settings({ s, explorer }: { s: Snapshot; explorer: string | null }) {
  return (
    <Section
      title="Settings"
      note={
        s.timelock ? (
          <>
            timelock <Addr address={s.timelock.address} explorer={explorer} /> · delay{' '}
            {duration(Number(s.timelock.minDelay))}
          </>
        ) : undefined
      }
    >
      <div className="columns">
        <div>
          <h3>Current params (next draws)</h3>
          <ParamsList p={s.params} />
        </div>
        <div>
          <h3>Pending timelock changes</h3>
          {!s.timelock ? (
            <Empty>No timelock address configured.</Empty>
          ) : s.timelock.pending.length === 0 ? (
            <Empty>Nothing scheduled.</Empty>
          ) : (
            s.timelock.pending.map((call) => (
              <div key={`${call.id}-${call.index}`} className="pending">
                <div>
                  <strong>{call.functionName}</strong>{' '}
                  <Badge level="warn">{call.state === 'ready' ? 'Ready' : 'Waiting'}</Badge>
                </div>
                <div className="muted small">
                  Executable from {watDateTime(call.readyAt)} WAT · id{' '}
                  <code>{call.id.slice(0, 10)}…</code>
                </div>
                {call.params ? <ParamsList p={call.params} /> : null}
              </div>
            ))
          )}
        </div>
      </div>
    </Section>
  );
}

function Players({ s, explorer }: { s: Snapshot; explorer: string | null }) {
  const stats = playerStats(s.purchases, s.links, s.credits);
  const cutoffs = new Map(s.draws.map((d) => [d.id, d.draw.cutoff]));
  const maxTickets = Math.max(1, ...stats.perDraw.map((d) => d.tickets));
  return (
    <Section title="Players" note="From TicketsBought, ReferrerSet and ReferralCredited events">
      <Stats>
        <Stat label="Players" value={stats.players} />
        <Stat label="Tickets sold" value={stats.tickets} />
        <Stat
          label="With a referrer"
          value={stats.withReferrer}
          hint={
            stats.players
              ? `${Math.round((100 * stats.withReferrer) / stats.players)}% of players`
              : undefined
          }
        />
        <Stat label="Referrers" value={stats.referrers} />
      </Stats>
      <div className="columns">
        <div>
          <h3>Per day</h3>
          {stats.perDraw.length === 0 ? (
            <Empty>No tickets yet.</Empty>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Draw</th>
                  <th className="num">Tickets</th>
                  <th className="num">Players</th>
                  <th className="num">New</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {[...stats.perDraw].reverse().map((d) => (
                  <tr key={d.drawId.toString()}>
                    <td>
                      #{d.drawId.toString()}{' '}
                      <span className="muted small">
                        {cutoffs.has(d.drawId) ? watDate(cutoffs.get(d.drawId)!) : ''}
                      </span>
                    </td>
                    <td className="num">{d.tickets}</td>
                    <td className="num">{d.buyers}</td>
                    <td className="num">{d.newPlayers}</td>
                    <td className="bar-cell">
                      <div
                        className="bar"
                        style={{ width: `${(100 * d.tickets) / maxTickets}%` }}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div>
          <h3>Top referrers</h3>
          {stats.topReferrers.length === 0 ? (
            <Empty>No referrals yet.</Empty>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Referrer</th>
                  <th className="num">Referred</th>
                  <th className="num">Earned</th>
                </tr>
              </thead>
              <tbody>
                {stats.topReferrers.map((r) => (
                  <tr key={r.referrer}>
                    <td>
                      <Addr address={r.referrer} explorer={explorer} />
                    </td>
                    <td className="num">{r.referred}</td>
                    <td className="num">{usd(r.earned)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </Section>
  );
}
