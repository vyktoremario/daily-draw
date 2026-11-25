// Server-only reads: one snapshot of everything the dashboard shows. Read-only by construction:
// a public client, no wallet, no keys.
import { dailyDrawAbi } from '@daily-draw/contracts';
import {
  createPublicClient,
  decodeFunctionData,
  erc20Abi,
  http,
  type Address,
  type PublicClient,
} from 'viem';
import { timelockAbi, vrfCoordinatorAbi, vrfProviderAbi } from './abis';
import type { AdminConfig } from './config';
import type {
  ContractBalances,
  DrawParams,
  NumberedDraw,
  PendingCall,
  Purchase,
  ReferralCredit,
  ReferrerLink,
  ScheduledCall,
  Subscription,
} from './figures';
import { pendingCalls } from './figures';
import { scanLogs } from './logs';

export interface DecodedCall extends PendingCall {
  functionName: string;
  /** Present for `setParams`. */
  params: DrawParams | null;
}

export interface Snapshot {
  blockNumber: bigint;
  /** The latest block's timestamp: the chain's clock. */
  now: number;
  currentDrawId: bigint;
  draws: NumberedDraw[];
  params: DrawParams;
  paused: boolean;
  balances: ContractBalances;
  usdc: Address;
  usdcHeld: bigint;
  treasury: Address;
  buybackReserve: Address;
  keeper: { address: Address; wei: bigint | null; hasRole: boolean | null } | null;
  drip: { address: Address; wei: bigint | null } | null;
  vrf: {
    adapter: Address;
    coordinator: Address | null;
    subscriptionId: bigint | null;
    nativePayment: boolean;
    subscription: Subscription | null;
  };
  purchases: Purchase[];
  links: ReferrerLink[];
  credits: ReferralCredit[];
  timelock: { address: Address; minDelay: bigint; pending: DecodedCall[] } | null;
  /** Reads that failed; the rest of the page still renders. */
  errors: string[];
}

/** Blocks behind the head that are cached between requests; newer blocks are re-read each time. */
const CONFIRMATIONS = 30n;
const logCache = new Map<string, { from: bigint; to: bigint; logs: unknown[] }>();

async function cachedScan<T>(
  key: string,
  fetchRange: (from: bigint, to: bigint) => Promise<T[]>,
  start: bigint,
  latest: bigint,
  chunk: bigint,
): Promise<T[]> {
  if (start > latest) return [];
  const settled = latest - CONFIRMATIONS >= start ? latest - CONFIRMATIONS : start - 1n;
  let entry = logCache.get(key);
  if (!entry || entry.from !== start) entry = { from: start, to: start - 1n, logs: [] };
  if (entry.to < settled) {
    const more = await scanLogs(fetchRange, entry.to + 1n, settled, chunk);
    entry = { from: start, to: settled, logs: [...entry.logs, ...more] };
    logCache.set(key, entry);
  }
  const tail = await scanLogs(fetchRange, entry.to + 1n, latest, chunk);
  return [...(entry.logs as T[]), ...tail];
}

let client: { url: string; chainId: number; client: PublicClient } | null = null;

function publicClient(config: AdminConfig): PublicClient {
  if (!client || client.url !== config.rpcUrl || client.chainId !== config.chain.id) {
    client = {
      url: config.rpcUrl,
      chainId: config.chain.id,
      client: createPublicClient({ chain: config.chain, transport: http(config.rpcUrl) }),
    };
  }
  return client.client;
}

/** Runs `read`, recording a failure instead of throwing. */
async function attempt<T>(errors: string[], label: string, read: () => Promise<T>) {
  try {
    return await read();
  } catch (err) {
    const message =
      err instanceof Error
        ? ((err as { shortMessage?: string }).shortMessage ?? err.message)
        : String(err);
    errors.push(`${label}: ${message.split('\n')[0]}`);
    return null;
  }
}

export async function loadSnapshot(config: AdminConfig): Promise<Snapshot> {
  const pub = publicClient(config);
  const game = { address: config.dailyDraw, abi: dailyDrawAbi } as const;
  const errors: string[] = [];

  const block = await pub.getBlock();
  const latest = block.number;

  const [
    currentDrawId,
    paramsTuple,
    paused,
    rollover,
    unclaimedWinnings,
    totalReferralBalances,
    treasuryBalance,
    buybackBalance,
    usdcOnChain,
    treasury,
    buybackReserve,
    adapter,
    keeperRole,
  ] = await Promise.all([
    pub.readContract({ ...game, functionName: 'currentDrawId' }),
    pub.readContract({ ...game, functionName: 'params' }),
    pub.readContract({ ...game, functionName: 'paused' }),
    pub.readContract({ ...game, functionName: 'rollover' }),
    pub.readContract({ ...game, functionName: 'unclaimedWinnings' }),
    pub.readContract({ ...game, functionName: 'totalReferralBalances' }),
    pub.readContract({ ...game, functionName: 'treasuryBalance' }),
    pub.readContract({ ...game, functionName: 'buybackBalance' }),
    pub.readContract({ ...game, functionName: 'usdc' }),
    pub.readContract({ ...game, functionName: 'treasury' }),
    pub.readContract({ ...game, functionName: 'buybackReserve' }),
    pub.readContract({ ...game, functionName: 'randomness' }),
    pub.readContract({ ...game, functionName: 'KEEPER_ROLE' }),
  ]);
  const [
    ticketPrice,
    feeBps,
    numberRange,
    winnersBps,
    teamBps,
    buybackBps,
    referrersBps,
    maxTicketsPerWallet,
    drawInterval,
    referrerActiveDays,
    unclaimedPrizeDays,
  ] = paramsTuple;
  const params: DrawParams = {
    ticketPrice,
    feeBps,
    numberRange,
    winnersBps,
    teamBps,
    buybackBps,
    referrersBps,
    maxTicketsPerWallet,
    drawInterval,
    referrerActiveDays,
    unclaimedPrizeDays,
  };
  const usdc = config.usdc ?? usdcOnChain;

  const ids: bigint[] = [];
  for (let id = 1n; id <= currentDrawId; id++) ids.push(id);

  const [draws, usdcHeld, keeperWei, keeperHasRole, dripWei, vrf, logs, timelock] =
    await Promise.all([
      Promise.all(
        ids.map(async (id) => ({
          id,
          draw: await pub.readContract({ ...game, functionName: 'getDraw', args: [id] }),
        })),
      ),
      pub.readContract({
        address: usdc,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [config.dailyDraw],
      }),
      config.keeper
        ? attempt(errors, 'Keeper balance', () => pub.getBalance({ address: config.keeper! }))
        : null,
      config.keeper
        ? attempt(errors, 'Keeper role', () =>
            pub.readContract({
              ...game,
              functionName: 'hasRole',
              args: [keeperRole, config.keeper!],
            }),
          )
        : null,
      config.dripWallet
        ? attempt(errors, 'Drip wallet balance', () =>
            pub.getBalance({ address: config.dripWallet! }),
          )
        : null,
      loadVrf(pub, config, adapter, errors),
      cachedScan(
        `${config.chain.id}:${config.dailyDraw}:game`,
        (from, to) =>
          pub.getContractEvents({ ...game, fromBlock: from, toBlock: to, strict: true }),
        config.startBlock,
        latest,
        config.logChunkBlocks,
      ),
      config.timelock
        ? attempt(errors, 'Timelock', () =>
            loadTimelock(pub, config, latest, Number(block.timestamp)),
          )
        : null,
    ]);

  const purchases: Purchase[] = [];
  const links: ReferrerLink[] = [];
  const credits: ReferralCredit[] = [];
  for (const log of logs) {
    if (log.eventName === 'TicketsBought') {
      purchases.push({
        drawId: log.args.drawId,
        player: log.args.player,
        numbers: log.args.numbers,
      });
    } else if (log.eventName === 'ReferrerSet') {
      links.push({ player: log.args.player, referrer: log.args.referrer });
    } else if (log.eventName === 'ReferralCredited') {
      credits.push({ referrer: log.args.referrer, amount: log.args.amount });
    }
  }

  return {
    blockNumber: latest,
    now: Number(block.timestamp),
    currentDrawId,
    draws,
    params,
    paused,
    balances: {
      rollover,
      unclaimedWinnings,
      totalReferralBalances,
      treasuryBalance,
      buybackBalance,
    },
    usdc,
    usdcHeld,
    treasury,
    buybackReserve,
    keeper: config.keeper
      ? { address: config.keeper, wei: keeperWei, hasRole: keeperHasRole }
      : null,
    drip: config.dripWallet ? { address: config.dripWallet, wei: dripWei } : null,
    vrf,
    purchases,
    links,
    credits,
    timelock,
    errors,
  };
}

async function loadVrf(
  pub: PublicClient,
  config: AdminConfig,
  adapter: Address,
  errors: string[],
): Promise<Snapshot['vrf']> {
  // The adapter knows its coordinator and subscription; env values only fill in when it can't be
  // read (e.g. a non-Chainlink randomness provider on a local chain).
  const [coordinator, adapterConfig] = await Promise.all([
    pub
      .readContract({ address: adapter, abi: vrfProviderAbi, functionName: 'coordinator' })
      .catch(() => null),
    pub
      .readContract({ address: adapter, abi: vrfProviderAbi, functionName: 'config' })
      .catch(() => null),
  ]);
  const coord = config.vrfCoordinator ?? coordinator;
  const subscriptionId = config.vrfSubscriptionId ?? adapterConfig?.[1] ?? null;
  const nativePayment = adapterConfig?.[4] ?? false;
  let subscription: Subscription | null = null;
  if (coord && subscriptionId !== null) {
    const sub = await attempt(errors, 'VRF subscription', () =>
      pub.readContract({
        address: coord,
        abi: vrfCoordinatorAbi,
        functionName: 'getSubscription',
        args: [subscriptionId],
      }),
    );
    if (sub) subscription = { link: sub[0], native: sub[1], consumers: sub[4] };
  }
  return { adapter, coordinator: coord, subscriptionId, nativePayment, subscription };
}

async function loadTimelock(
  pub: PublicClient,
  config: AdminConfig,
  latest: bigint,
  now: number,
): Promise<NonNullable<Snapshot['timelock']>> {
  const address = config.timelock!;
  const [minDelay, logs] = await Promise.all([
    pub.readContract({ address, abi: timelockAbi, functionName: 'getMinDelay' }),
    cachedScan(
      `${config.chain.id}:${address}:timelock`,
      (from, to) =>
        pub.getContractEvents({
          address,
          abi: timelockAbi,
          eventName: 'CallScheduled',
          fromBlock: from,
          toBlock: to,
          strict: true,
        }),
      config.startBlock,
      latest,
      config.logChunkBlocks,
    ),
  ]);
  const scheduled: ScheduledCall[] = logs.map((l) => ({
    id: l.args.id,
    index: l.args.index,
    target: l.args.target,
    data: l.args.data,
    delay: l.args.delay,
  }));
  const ids = [...new Set(scheduled.map((s) => s.id))];
  const stamps = await Promise.all(
    ids.map((id) =>
      pub.readContract({ address, abi: timelockAbi, functionName: 'getTimestamp', args: [id] }),
    ),
  );
  const timestamps = new Map(ids.map((id, i) => [id as string, stamps[i]!]));
  const pending = pendingCalls(scheduled, timestamps, config.dailyDraw, now).map((call) => {
    try {
      const decoded = decodeFunctionData({ abi: dailyDrawAbi, data: call.data });
      const params = decoded.functionName === 'setParams' ? (decoded.args[0] as DrawParams) : null;
      return { ...call, functionName: decoded.functionName, params };
    } catch {
      return { ...call, functionName: call.data.slice(0, 10), params: null };
    }
  });
  return { address, minDelay, pending };
}
