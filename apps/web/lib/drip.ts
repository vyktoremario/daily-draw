import { getAddress, isAddress, parseEther, type Address, type Hash } from 'viem';
import { anvil, baseSepolia, celoSepolia } from 'viem/chains';

/**
 * Gas drip: a little test ETH for new testnet wallets, so their first transaction (the test USDC
 * faucet) doesn't fail. Everything here is pure or takes its dependencies as arguments, so the
 * limits are unit-tested without a chain or a database; `drip-server.ts` wires in the real ones.
 */

/** The only chains the drip ever sends on. Checked against the RPC, not just the config. */
export const DRIP_CHAIN_IDS: readonly number[] = [anvil.id, baseSepolia.id, celoSepolia.id];

export interface DripSettings {
  /** Sent per drip. */
  amountWei: bigint;
  /** Only wallets holding less than this get a drip. */
  minBalanceWei: bigint;
  /** Total the drip may send per UTC day. */
  dailyCapWei: bigint;
  /** Drip requests per IP address per UTC day. */
  perIpDaily: number;
}

export const DEFAULT_DRIP: DripSettings = {
  amountWei: parseEther('0.0005'),
  minBalanceWei: parseEther('0.0001'),
  dailyCapWei: parseEther('0.01'),
  perIpDaily: 5,
};

function eth(value: string | undefined, fallback: bigint): bigint {
  if (!value || !/^\d+(\.\d+)?$/.test(value.trim())) return fallback;
  return parseEther(value.trim());
}

export function parseDripSettings(env: Partial<Record<string, string | undefined>>): DripSettings {
  const perIp = Number(env.DRIP_PER_IP_DAILY);
  return {
    amountWei: eth(env.DRIP_AMOUNT_ETH, DEFAULT_DRIP.amountWei),
    minBalanceWei: eth(env.DRIP_MIN_BALANCE_ETH, DEFAULT_DRIP.minBalanceWei),
    dailyCapWei: eth(env.DRIP_DAILY_CAP_ETH, DEFAULT_DRIP.dailyCapWei),
    perIpDaily: Number.isInteger(perIp) && perIp > 0 ? perIp : DEFAULT_DRIP.perIpDaily,
  };
}

/**
 * The little the drip remembers. Daily totals are kept in gwei so they stay well inside the
 * integers JSON (and Redis's REST API) carries exactly.
 */
export interface DripStore {
  /** Counts a request from `ip` on `day`; returns the count including this one. */
  hitIp(ip: string, day: string): Promise<number>;
  /** Marks `address` as dripped; false if it already was. */
  claimAddress(address: Address): Promise<boolean>;
  /** Undoes `claimAddress` after a failed send. */
  releaseAddress(address: Address): Promise<void>;
  /** Adds `gwei` (negative to undo) to `day`'s total; returns the new total. */
  addToDay(day: string, gwei: number): Promise<number>;
  /** One sender at a time, so two drips never pick the same nonce. */
  lock(): Promise<boolean>;
  unlock(): Promise<void>;
}

export interface DripChain {
  /** The chain id the RPC actually reports. */
  chainId(): Promise<number>;
  balance(address: Address): Promise<bigint>;
  /** The drip wallet's own balance. */
  dripBalance(): Promise<bigint>;
  /** Sends `wei` to `to`; resolves once the transaction is broadcast. */
  send(to: Address, wei: bigint): Promise<Hash>;
}

export interface DripDeps {
  settings: DripSettings;
  /** From the app's config (`NEXT_PUBLIC_CHAIN`). */
  configTestnet: boolean;
  /** Null when Redis isn't configured: the drip refuses rather than run without limits. */
  store: DripStore | null;
  /** Null when the drip wallet's key isn't set. */
  chain: DripChain | null;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  log?: (message: string) => void;
}

export type DripRefusal =
  | 'not-testnet'
  | 'bad-request'
  | 'has-gas'
  | 'already-dripped'
  | 'ip-limit'
  | 'daily-cap'
  | 'drip-empty'
  | 'busy'
  | 'unavailable';

export type DripResult =
  { ok: true; hash: Hash; amountWei: bigint } | { ok: false; reason: DripRefusal };

/** HTTP status for each outcome. */
export function dripStatusCode(result: DripResult): number {
  if (result.ok) return 200;
  switch (result.reason) {
    case 'bad-request':
      return 400;
    case 'not-testnet':
      return 403;
    case 'has-gas':
    case 'already-dripped':
      return 409;
    case 'ip-limit':
    case 'daily-cap':
    case 'busy':
      return 429;
    default:
      return 503;
  }
}

/** The address from a request body of exactly `{ "address": "0x…" }`; null for anything else. */
export function parseDripBody(body: unknown): Address | null {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return null;
  const keys = Object.keys(body);
  if (keys.length !== 1 || keys[0] !== 'address') return null;
  const address = (body as { address: unknown }).address;
  if (typeof address !== 'string' || !isAddress(address, { strict: false })) return null;
  return getAddress(address);
}

/** The UTC day a request counts against, e.g. "2026-11-25". */
export function dripDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}

const GWEI = 1_000_000_000n;
/** Rounded up, so the daily total never undercounts. */
export function toGwei(wei: bigint): number {
  return Number((wei + GWEI - 1n) / GWEI);
}

/** Room the drip wallet keeps for its own gas. */
const SEND_GAS_RESERVE = parseEther('0.0001');
const LOCK_TRIES = 20;
const LOCK_WAIT_MS = 250;

/**
 * Decides and, if every limit allows it, sends one drip. Any store or chain failure refuses
 * ("unavailable") and undoes what it counted, so an outage never means sending without limits.
 */
export async function runDrip(
  address: Address | null,
  ip: string,
  deps: DripDeps,
): Promise<DripResult> {
  const { settings, store, chain } = deps;
  const now = deps.now ?? (() => new Date());
  const sleep = deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const log = deps.log ?? (() => {});

  if (!deps.configTestnet) return { ok: false, reason: 'not-testnet' };
  if (!address) return { ok: false, reason: 'bad-request' };
  if (!store || !chain) return { ok: false, reason: 'unavailable' };

  const day = dripDay(now());
  const gwei = toGwei(settings.amountWei);
  let claimed = false;
  let counted = false;
  let locked = false;
  try {
    if (!DRIP_CHAIN_IDS.includes(await chain.chainId()))
      return { ok: false, reason: 'not-testnet' };
    if ((await chain.balance(address)) >= settings.minBalanceWei) {
      return { ok: false, reason: 'has-gas' };
    }
    if ((await store.hitIp(ip, day)) > settings.perIpDaily)
      return { ok: false, reason: 'ip-limit' };

    claimed = await store.claimAddress(address);
    if (!claimed) return { ok: false, reason: 'already-dripped' };

    counted = true;
    if ((await store.addToDay(day, gwei)) > toGwei(settings.dailyCapWei)) {
      log(`drip: daily cap reached (${day}); refused ${address}`);
      throw new Refused('daily-cap');
    }

    for (let i = 0; i < LOCK_TRIES && !locked; i++) {
      locked = await store.lock();
      if (!locked) await sleep(LOCK_WAIT_MS);
    }
    if (!locked) throw new Refused('busy');

    const funds = await chain.dripBalance();
    if (funds < settings.amountWei + SEND_GAS_RESERVE) {
      log(`drip: wallet nearly empty (${funds} wei); refused ${address}`);
      throw new Refused('drip-empty');
    }
    const hash = await chain.send(address, settings.amountWei);
    log(
      `drip: sent ${settings.amountWei} wei to ${address} (${hash}); drip wallet had ${funds} wei`,
    );
    return { ok: true, hash, amountWei: settings.amountWei };
  } catch (error) {
    if (counted) await store.addToDay(day, -gwei).catch(() => {});
    if (claimed) await store.releaseAddress(address).catch(() => {});
    if (error instanceof Refused) return { ok: false, reason: error.reason };
    log(`drip: failed for ${address}: ${error instanceof Error ? error.message : String(error)}`);
    return { ok: false, reason: 'unavailable' };
  } finally {
    if (locked) await store.unlock().catch(() => {});
  }
}

class Refused extends Error {
  constructor(readonly reason: DripRefusal) {
    super(reason);
  }
}

export interface DripStatus {
  /** Whether a drip could be sent right now (ignoring per-address limits). */
  available: boolean;
  amountWei: string;
  minBalanceWei: string;
  dripAddress: Address | null;
  dripBalanceWei: string | null;
}

/** For `GET /api/drip`: what the app shows, and an easy way to check the drip wallet. */
export async function dripStatus(
  deps: Pick<DripDeps, 'settings' | 'configTestnet' | 'store' | 'chain'> & {
    dripAddress: Address | null;
  },
): Promise<DripStatus> {
  const base = {
    amountWei: deps.settings.amountWei.toString(),
    minBalanceWei: deps.settings.minBalanceWei.toString(),
    dripAddress: deps.dripAddress,
  };
  if (!deps.configTestnet || !deps.store || !deps.chain) {
    return { ...base, available: false, dripBalanceWei: null };
  }
  try {
    const [chainId, balance] = await Promise.all([deps.chain.chainId(), deps.chain.dripBalance()]);
    return {
      ...base,
      available:
        DRIP_CHAIN_IDS.includes(chainId) && balance >= deps.settings.amountWei + SEND_GAS_RESERVE,
      dripBalanceWei: balance.toString(),
    };
  } catch {
    return { ...base, available: false, dripBalanceWei: null };
  }
}

/** In-memory store, for tests. */
export function memoryDripStore(): DripStore & { days: Map<string, number> } {
  const ips = new Map<string, number>();
  const addresses = new Set<string>();
  const days = new Map<string, number>();
  let held = false;
  return {
    days,
    async hitIp(ip, day) {
      const key = `${day}:${ip}`;
      ips.set(key, (ips.get(key) ?? 0) + 1);
      return ips.get(key)!;
    },
    async claimAddress(address) {
      const key = address.toLowerCase();
      if (addresses.has(key)) return false;
      addresses.add(key);
      return true;
    },
    async releaseAddress(address) {
      addresses.delete(address.toLowerCase());
    },
    async addToDay(day, gwei) {
      days.set(day, (days.get(day) ?? 0) + gwei);
      return days.get(day)!;
    },
    async lock() {
      if (held) return false;
      held = true;
      return true;
    },
    async unlock() {
      held = false;
    },
  };
}
