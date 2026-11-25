import type { Snapshot } from './chain';
import type { Thresholds } from './config';
import {
  balanceCheck,
  drawChecks,
  obligations,
  solvency,
  sortChecks,
  vrfChecks,
  type Check,
} from './figures';
import { token18, usd, watDateTime } from './format';

/** Every health check for one snapshot, most serious first. */
export function healthChecks(s: Snapshot, t: Thresholds, nativeSymbol: string): Check[] {
  const eth = (v: bigint) => token18(v, nativeSymbol);
  const checks: Check[] = [
    ...drawChecks(s.draws, s.now, t.closeGraceSeconds, t.randomnessGraceSeconds),
  ];

  checks.push(
    s.paused
      ? {
          level: 'alert',
          title: 'Contract paused',
          detail: 'Buying and closing are stopped; claims, refunds and withdrawals still work.',
        }
      : { level: 'ok', title: 'Contract running', detail: 'Not paused.' },
  );

  const owed = obligations(s.draws, s.balances).total;
  const cover = solvency(s.usdcHeld, owed);
  checks.push(
    cover.covered
      ? {
          level: 'ok',
          title: 'USDC covers what is owed',
          detail: `Holds ${usd(cover.held)} against ${usd(cover.owed)} owed${cover.surplus > 0n ? ` (${usd(cover.surplus)} extra)` : ''}.`,
        }
      : {
          level: 'alert',
          title: 'USDC short of what is owed',
          detail: `Holds ${usd(cover.held)} but owes ${usd(cover.owed)}: ${usd(-cover.surplus)} short.`,
        },
  );

  if (s.keeper) {
    checks.push(
      balanceCheck(
        'Keeper ETH',
        s.keeper.wei,
        t.keeperMinWei,
        eth,
        'Top up the keeper wallet or it cannot close draws.',
      ),
    );
    if (s.keeper.hasRole === false) {
      checks.push({
        level: 'warn',
        title: 'Keeper lacks KEEPER_ROLE',
        detail: 'It can still close draws (anyone can) but cannot claim for winners after 24h.',
      });
    }
  }

  checks.push(
    ...vrfChecks(
      s.vrf.subscription,
      s.vrf.nativePayment,
      s.vrf.adapter,
      t.vrfMinLink,
      t.vrfMinNative,
      (v) => token18(v, 'LINK', 2),
      eth,
    ),
  );

  if (s.drip) {
    checks.push(
      balanceCheck(
        'Drip wallet ETH',
        s.drip.wei,
        t.dripMinWei,
        eth,
        'Top it up so new players still get gas.',
      ),
    );
  }

  for (const call of s.timelock?.pending ?? []) {
    checks.push({
      level: 'warn',
      title: `Timelock: ${call.functionName} ${call.state === 'ready' ? 'ready to execute' : 'pending'}`,
      detail:
        call.state === 'ready'
          ? `Executable since ${watDateTime(call.readyAt)} WAT.`
          : `Executable from ${watDateTime(call.readyAt)} WAT.`,
    });
  }

  for (const error of s.errors) {
    checks.push({ level: 'warn', title: 'Read failed', detail: error });
  }
  return sortChecks(checks);
}
