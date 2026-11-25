import { createPublicClient, createWalletClient, http, isHex, type Address } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { appConfig } from './config';
import { parseDripSettings, type DripChain, type DripDeps, type DripStore } from './drip';

/**
 * Server-only wiring for the gas drip (imported by app/api/drip/route.ts, never by a page).
 * DRIP_PRIVATE_KEY and the Redis token are plain (non-NEXT_PUBLIC) env vars, so Next.js never
 * puts them in the browser bundle.
 */

const PREFIX = `dailydraw:drip:${appConfig.chain.id}`;
const DAY_SECONDS = 60 * 60 * 24;

/**
 * Upstash Redis over its REST API (plain fetch, no client library). Vercel's Upstash
 * integration sets KV_REST_API_URL / KV_REST_API_TOKEN; Upstash's own console calls them
 * UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN. Either works.
 */
export function upstashStore(url: string, token: string): DripStore {
  async function call<T>(...command: (string | number)[]): Promise<T> {
    const response = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(command),
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    });
    const json = (await response.json()) as { result?: T; error?: string };
    if (!response.ok || json.error !== undefined) {
      throw new Error(`Redis ${String(command[0])}: ${json.error ?? response.status}`);
    }
    return json.result as T;
  }
  return {
    async hitIp(ip, day) {
      const key = `${PREFIX}:ip:${day}:${ip}`;
      const count = await call<number>('INCR', key);
      if (count === 1) await call('EXPIRE', key, DAY_SECONDS * 2);
      return count;
    },
    async claimAddress(address) {
      const key = `${PREFIX}:addr:${address.toLowerCase()}`;
      return (await call<string | null>('SET', key, new Date().toISOString(), 'NX')) === 'OK';
    },
    async releaseAddress(address) {
      await call('DEL', `${PREFIX}:addr:${address.toLowerCase()}`);
    },
    async addToDay(day, gwei) {
      const key = `${PREFIX}:day:${day}`;
      const total = await call<number>('INCRBY', key, gwei);
      await call('EXPIRE', key, DAY_SECONDS * 7);
      return total;
    },
    async lock() {
      return (await call<string | null>('SET', `${PREFIX}:lock`, '1', 'NX', 'PX', 20_000)) === 'OK';
    },
    async unlock() {
      await call('DEL', `${PREFIX}:lock`);
    },
  };
}

function dripAccount() {
  const key = process.env.DRIP_PRIVATE_KEY?.trim();
  if (!key) return null;
  const hex = key.startsWith('0x') ? key : `0x${key}`;
  if (!isHex(hex) || hex.length !== 66) {
    console.error('drip: DRIP_PRIVATE_KEY is not a 32-byte hex key; drip disabled');
    return null;
  }
  return privateKeyToAccount(hex);
}

function viemChain(): DripChain | null {
  const account = dripAccount();
  if (!account) return null;
  const transport = http(process.env.DRIP_RPC_URL || appConfig.rpcUrl);
  const publicClient = createPublicClient({ chain: appConfig.chain, transport });
  const walletClient = createWalletClient({ account, chain: appConfig.chain, transport });
  return {
    chainId: () => publicClient.getChainId(),
    balance: (address) => publicClient.getBalance({ address }),
    dripBalance: () => publicClient.getBalance({ address: account.address }),
    send: (to, value) => walletClient.sendTransaction({ to, value }),
  };
}

export function dripDeps(): DripDeps & { dripAddress: Address | null } {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  return {
    settings: parseDripSettings(process.env),
    configTestnet: appConfig.isTestnet,
    store: url && token ? upstashStore(url, token) : null,
    chain: viemChain(),
    dripAddress: dripAccount()?.address ?? null,
    log: (message) => console.info(message),
  };
}

/** The caller's IP as Vercel reports it. */
export function clientIp(headers: Headers): string {
  return (
    headers.get('x-real-ip') || headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  );
}
