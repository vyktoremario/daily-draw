'use client';

import { formatUsdc } from '@daily-draw/shared';
import { useParams } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { getAddress, isAddress, zeroAddress, type Address } from 'viem';
import { useReadContract } from 'wagmi';
import { AppShell, useMounted } from '../../../components/AppShell';
import { Icon, NumberBadge, num } from '../../../components/ui';
import { appConfig } from '../../../lib/config';
import { DrawStatus, GAME, useDraw, usePlayer, type Draw } from '../../../lib/game';
import { formatWatDate } from '../../../lib/time';
import { walletTickets, type Check, type CheckGroup } from '../../../lib/verify';
import { explorerUrl, useDrawEvidence, type DrawEvidence } from '../../../lib/verify-chain';

/** "Verify this draw" (#13): the checks run here, in the browser, on public chain data only. */
export default function VerifyPage() {
  const params = useParams<{ id: string }>();
  const mounted = useMounted();
  const drawId = /^\d+$/.test(params.id) ? BigInt(params.id) : undefined;
  const { data: draw, isLoading } = useDraw(drawId);
  const evidence = useDrawEvidence(drawId, draw);

  return (
    <AppShell title={`Verify draw #${params.id}`} back="/results">
      {!mounted || (isLoading && drawId !== undefined) ? (
        <p className="muted">Loading…</p>
      ) : drawId === undefined || !draw || draw.status === DrawStatus.None ? (
        <div className="card muted">No such draw.</div>
      ) : (
        <>
          <Summary drawId={drawId} draw={draw} evidence={evidence.data} error={evidence.isError} />
          {evidence.data?.trail && <Randomness evidence={evidence.data} />}
          {evidence.data?.verification && (
            <>
              <CheckList
                title="Tickets"
                group="tickets"
                checks={evidence.data.verification.checks}
              />
              <CheckList title="Payout" group="payout" checks={evidence.data.verification.checks} />
            </>
          )}
          <WalletCheck drawId={drawId} draw={draw} evidence={evidence.data} />
          {evidence.data?.verification && <FullMaths draw={draw} evidence={evidence.data} />}
        </>
      )}
    </AppShell>
  );
}

function Summary({
  drawId,
  draw,
  evidence,
  error,
}: {
  drawId: bigint;
  draw: Draw;
  evidence: DrawEvidence | undefined;
  error: boolean;
}) {
  const v = evidence?.verification;
  const failed = v?.checks.filter((c) => !c.pass).length ?? 0;
  let line: ReactNode;
  if (error) line = 'Could not read the chain. Check your connection and reload.';
  else if (draw.status === DrawStatus.Open)
    line = 'Sales are open. Come back after the draw at 9pm WAT.';
  else if (draw.status === DrawStatus.Closed) line = 'Sales closed. Waiting for the random number…';
  else if (draw.status === DrawStatus.Voided)
    line = 'Cancelled: no random number arrived, so every ticket can be refunded in full.';
  else if (!evidence) line = 'Running the checks…';
  else if (!v) line = 'The settlement events for this draw could not be found.';
  else if (failed === 0) line = `All ${v.checks.length} checks passed.`;
  else line = `${failed} of ${v.checks.length} checks failed.`;

  const tone = v ? (failed === 0 ? 'pass' : 'fail') : 'wait';
  return (
    <section className="hero" aria-label="Result" data-testid="verify-summary" data-result={tone}>
      <span className="sub">
        Draw #{drawId.toString()} · {formatWatDate(draw.cutoff)}
      </span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        {v && <NumberBadge value={draw.winningNumber} size="lg" win={failed === 0} />}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {v && (
            <span
              className={failed === 0 ? 'pill pill-green' : 'pill verify-fail'}
              style={{ alignSelf: 'flex-start' }}
            >
              {failed === 0 ? (
                <>
                  <Icon name="check" size={16} /> Verified
                </>
              ) : (
                <>
                  <Icon name="close" size={16} /> Does not match
                </>
              )}
            </span>
          )}
          <span style={{ fontWeight: 600 }}>{line}</span>
        </div>
      </div>
      <span className="sub">
        {v
          ? `Your browser redid this draw from public ${appConfig.chain.name} data. No server, no wallet needed.`
          : `Once the number is in, your browser redoes the draw from public ${appConfig.chain.name} data.`}
      </span>
    </section>
  );
}

function ExternalLink({
  kind,
  value,
  children,
}: {
  kind: 'tx' | 'address';
  value: string;
  children?: ReactNode;
}) {
  const href = explorerUrl(kind, value);
  const text = children ?? short(value);
  return href ? (
    <a href={href} target="_blank" rel="noreferrer" title={value}>
      {text}
    </a>
  ) : (
    <span title={value}>{text}</span>
  );
}

/** Shorten hashes, addresses and long ids; leave amounts and words alone. */
function short(value: string): string {
  return /^(0x)?[0-9a-fA-F]{15,}$/.test(value) ? `${value.slice(0, 8)}…${value.slice(-6)}` : value;
}

function Randomness({ evidence }: { evidence: DrawEvidence }) {
  const t = evidence.trail!;
  const v = evidence.verification;
  return (
    <section
      aria-label="Random number"
      style={{ display: 'flex', flexDirection: 'column', gap: 10 }}
    >
      <div className="section-head">
        <h2>Random number</h2>
        <span className="muted" style={{ fontSize: 13 }}>
          {t.coordinator ? 'Chainlink VRF v2.5' : 'Dev randomness'}
        </span>
      </div>
      <div className="card">
        <dl className="kv">
          <dt>Request id</dt>
          <dd title={t.requestId.toString()}>{short(t.requestId.toString())}</dd>
          <dt>Requested in</dt>
          <dd>
            <ExternalLink kind="tx" value={t.requestTx} />
          </dd>
          <dt>Answered in</dt>
          <dd>{t.fulfilTx ? <ExternalLink kind="tx" value={t.fulfilTx} /> : 'Not yet'}</dd>
          {t.coordinator && (
            <>
              <dt>VRF coordinator</dt>
              <dd>
                <ExternalLink kind="address" value={t.coordinator} />
              </dd>
            </>
          )}
          {t.provider && (
            <>
              <dt>Game&apos;s VRF adapter</dt>
              <dd>
                <ExternalLink kind="address" value={t.provider} />
              </dd>
            </>
          )}
          {t.keyHash && (
            <>
              <dt>Key hash</dt>
              <dd title={t.keyHash}>{short(t.keyHash)}</dd>
            </>
          )}
        </dl>
      </div>
      {v && <Checks checks={v.checks.filter((c) => c.group === 'randomness')} />}
      {v && t.coordinator && (
        <p className="muted" style={{ fontSize: 13, margin: 0 }}>
          The coordinator checked the elliptic-curve proof on-chain before passing the word on. Your
          browser checks everything that ties that proof to this draw.
        </p>
      )}
    </section>
  );
}

function CheckList({
  title,
  group,
  checks,
}: {
  title: string;
  group: CheckGroup;
  checks: Check[];
}) {
  return (
    <section aria-label={title} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div className="section-head">
        <h2>{title}</h2>
      </div>
      <Checks checks={checks.filter((c) => c.group === group)} />
    </section>
  );
}

function Checks({ checks }: { checks: Check[] }) {
  return (
    <ul className="list checks">
      {checks.map((c) => (
        <li key={c.id} className="list-row" data-check={c.id} data-pass={c.pass}>
          <span
            className={c.pass ? 'check-mark' : 'check-mark check-fail'}
            aria-label={c.pass ? 'Pass' : 'Fail'}
          >
            <Icon name={c.pass ? 'check' : 'close'} size={16} />
          </span>
          <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontSize: 14 }}>{c.label}</span>
            {c.pass ? (
              <span className="muted mono">{short(c.actual)}</span>
            ) : (
              <span className="mono" style={{ color: '#8a1c12' }}>
                Expected {short(c.expected)}, recorded {short(c.actual)}
              </span>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}

function WalletCheck({
  drawId,
  draw,
  evidence,
}: {
  drawId: bigint;
  draw: Draw;
  evidence: DrawEvidence | undefined;
}) {
  const { address } = usePlayer();
  const [input, setInput] = useState('');
  useEffect(() => {
    if (address) setInput((current) => current || address);
  }, [address]);
  const valid = isAddress(input.trim(), { strict: false });
  const player: Address | undefined = valid ? getAddress(input.trim()) : undefined;
  const settled = draw.status === DrawStatus.Settled || draw.status === DrawStatus.Swept;
  const { data: claimed } = useReadContract({
    ...GAME,
    functionName: 'claimed',
    args: [drawId, player ?? zeroAddress],
    query: { enabled: settled && !!player },
  });
  const result =
    player && evidence
      ? walletTickets(
          evidence.purchases,
          player,
          settled ? draw.winningNumber : undefined,
          draw.prizePerTicket,
        )
      : undefined;

  return (
    <section
      aria-label="Your tickets"
      style={{ display: 'flex', flexDirection: 'column', gap: 10 }}
    >
      <div className="section-head">
        <h2>Your tickets</h2>
      </div>
      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 14 }}>
          Wallet address
          <input
            className="field mono"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="0x…"
            spellCheck={false}
            autoComplete="off"
            data-testid="verify-wallet"
          />
        </label>
        {input.trim() !== '' && !valid && (
          <span style={{ fontSize: 14, color: '#8a1c12' }}>That isn&apos;t a wallet address.</span>
        )}
        {!evidence && player && <span className="muted">Loading…</span>}
        {result && result.tickets === 0 && (
          <span className="muted" style={{ fontSize: 14 }}>
            No tickets from this wallet in draw #{drawId.toString()}.
          </span>
        )}
        {result && result.tickets > 0 && (
          <>
            <span style={{ fontSize: 14 }}>
              {result.tickets} ticket{result.tickets === 1 ? '' : 's'} in {result.purchases.length}{' '}
              purchase{result.purchases.length === 1 ? '' : 's'}:
            </span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {result.numbers.map(({ number, count }) => {
                const won = settled && number === draw.winningNumber;
                return (
                  <span
                    key={number}
                    className={won ? 'pill pill-gold' : 'pill pill-grey'}
                    style={{
                      fontSize: 15,
                      ...(won ? { background: 'var(--gold)', color: 'var(--ink)' } : {}),
                    }}
                  >
                    {num(number)}
                    {count > 1 ? ` ×${count}` : ''}
                  </span>
                );
              })}
            </div>
            {settled &&
              (result.winningTickets > 0 ? (
                <span style={{ fontWeight: 600 }}>
                  Won: {result.winningTickets} ticket{result.winningTickets === 1 ? '' : 's'} on{' '}
                  {num(draw.winningNumber)}, {formatUsdc(result.prize)}
                  {claimed ? ' · claimed' : ' · not claimed yet'}
                </span>
              ) : (
                <span className="muted" style={{ fontSize: 14 }}>
                  None on {num(draw.winningNumber)}, so no win this draw.
                </span>
              ))}
            <span style={{ fontSize: 13, display: 'flex', flexWrap: 'wrap', gap: '4px 10px' }}>
              {result.purchases.map((p, i) =>
                p.txHash ? (
                  <ExternalLink key={`${p.txHash}-${i}`} kind="tx" value={p.txHash}>
                    Purchase {i + 1}
                  </ExternalLink>
                ) : null,
              )}
            </span>
          </>
        )}
      </div>
    </section>
  );
}

function FullMaths({ draw, evidence }: { draw: Draw; evidence: DrawEvidence }) {
  const v = evidence.verification!;
  const vrf = evidence.vrf!;
  const p = draw.params;
  const inputs: [string, string][] = [
    ['Number range', `${p.numberRange} (00–${p.numberRange - 1})`],
    ['Ticket price', formatUsdc(p.ticketPrice)],
    ['Fee', `${p.feeBps / 100}% on top, not in the pool`],
    [
      'Split',
      `winners ${p.winnersBps / 100}%, referrers ${p.referrersBps / 100}%, team ${p.teamBps / 100}%, buy-back ${p.buybackBps / 100}%`,
    ],
    ['Rollover brought in', formatUsdc(evidence.rolloverIn ?? 0n)],
    ['Request id', vrf.requestId.toString()],
  ];
  if (vrf.request) {
    inputs.push(
      ['Key hash', vrf.request.keyHash],
      ['Request seed', vrf.request.preSeed.toString()],
    );
  }
  if (v.proof) {
    inputs.push(
      ['Proof public key', `[${v.proof.pk[0]}, ${v.proof.pk[1]}]`],
      ['Proof gamma', `[${v.proof.gamma[0]}, ${v.proof.gamma[1]}]`],
    );
  }
  if (vrf.fulfilled) inputs.push(['Coordinator output', vrf.fulfilled.outputSeed.toString()]);
  inputs.push(['Random word received', vrf.delivered.toString()]);

  return (
    <details className="card maths">
      <summary>See the full maths</summary>
      <h3>Inputs</h3>
      <dl className="kv">
        {inputs.map(([k, value]) => (
          <KV key={k} k={k} value={value} />
        ))}
      </dl>
      <h3>Steps</h3>
      <ol>
        {v.steps.map((s) => (
          <li key={s.label}>
            <strong>{s.label}</strong>
            <span className="muted mono">{s.formula}</span>
            <span className="mono">{s.value}</span>
          </li>
        ))}
      </ol>
      <p className="muted" style={{ fontSize: 13, margin: 0 }}>
        Same maths as <code>DailyDraw.sol</code> (<code>fulfillRandomness</code> and{' '}
        <code>_settle</code>) and the Chainlink VRF v2.5 coordinator. Every value comes from public
        contract events read by your browser.
      </p>
    </details>
  );
}

function KV({ k, value }: { k: string; value: string }) {
  return (
    <>
      <dt>{k}</dt>
      <dd className="mono" style={{ wordBreak: 'break-all' }}>
        {value}
      </dd>
    </>
  );
}
