// Dashboard settings from server-side environment variables (never NEXT_PUBLIC_: nothing here
// reaches the browser). Defaults come from a committed deployment file
// (packages/contracts/deployments/<network>.json) so a Base Sepolia dashboard needs no addresses.
import type { TestnetDeployment } from '@daily-draw/contracts';
import baseSepoliaDeployment from '@daily-draw/contracts/deployments/base-sepolia.json';
import { getAddress, isAddress, parseEther, parseUnits, type Address, type Chain } from 'viem';
import { anvil, base, baseSepolia, celo, celoSepolia } from 'viem/chains';

export const CHAINS: readonly Chain[] = [anvil, baseSepolia, celoSepolia, base, celo];

/** Deployment files bundled with the dashboard, by network name. */
export const DEPLOYMENTS: Record<string, TestnetDeployment> = {
  'base-sepolia': baseSepoliaDeployment as TestnetDeployment,
};

/**
 * RPCs that serve eth_getLogs over long block ranges. A chain's public RPC is often capped
 * (sepolia.base.org: 200 blocks), which would mean thousands of requests per scan.
 */
export const DEFAULT_RPC_URLS: Record<number, string> = {
  [baseSepolia.id]: 'https://base-sepolia.gateway.tenderly.co',
};

export interface Thresholds {
  /** Warn when the keeper wallet holds less ETH than this (wei). */
  keeperMinWei: bigint;
  /** Warn when the drip wallet holds less ETH than this (wei). */
  dripMinWei: bigint;
  /** Warn when the VRF subscription holds less LINK than this (juels, 18 decimals). */
  vrfMinLink: bigint;
  /** Warn when the VRF subscription holds less native token than this (wei), if it pays in it. */
  vrfMinNative: bigint;
  /** How long after its cutoff an open draw may wait for the keeper before it's flagged (s). */
  closeGraceSeconds: number;
  /** How long a closed draw may wait for randomness before it's flagged (s). */
  randomnessGraceSeconds: number;
  /** Flag settled draws with unclaimed prizes this many days before they can be swept. */
  sweepWarnDays: number;
}

export interface AdminConfig {
  chain: Chain;
  rpcUrl: string;
  /** Deployment file the defaults came from, if any. */
  deployment: string | null;
  dailyDraw: Address;
  /** Read from the contract when not set. */
  usdc: Address | null;
  timelock: Address | null;
  startBlock: bigint;
  keeper: Address | null;
  /** Read from the randomness adapter when not set. */
  vrfCoordinator: Address | null;
  vrfSubscriptionId: bigint | null;
  dripWallet: Address | null;
  /** Largest block range per eth_getLogs request; halved automatically if the RPC refuses. */
  logChunkBlocks: bigint;
  thresholds: Thresholds;
}

export type Env = Partial<Record<string, string | undefined>>;

function optionalAddress(env: Env, name: string, fallback?: string): Address | null {
  const value = env[name] || fallback;
  if (!value) return null;
  if (!isAddress(value, { strict: false })) throw new Error(`${name}="${value}" is not an address`);
  return getAddress(value);
}

function bigintOr(env: Env, name: string, fallback: bigint | null): bigint | null {
  const value = env[name];
  if (!value) return fallback;
  if (!/^\d+$/.test(value)) throw new Error(`${name}="${value}" is not a whole number`);
  return BigInt(value);
}

function decimal(env: Env, name: string, fallback: string, decimals = 18): bigint {
  const value = env[name] || fallback;
  if (!/^\d+(\.\d+)?$/.test(value)) throw new Error(`${name}="${value}" is not a number`);
  return decimals === 18 ? parseEther(value) : parseUnits(value, decimals);
}

function minutes(env: Env, name: string, fallback: number): number {
  const value = env[name];
  if (!value) return fallback * 60;
  if (!/^\d+$/.test(value)) throw new Error(`${name}="${value}" is not a whole number of minutes`);
  return Number(value) * 60;
}

export function parseAdminConfig(
  env: Env,
  deployments: Record<string, TestnetDeployment> = DEPLOYMENTS,
): AdminConfig {
  const name = env.DEPLOYMENT ?? 'base-sepolia';
  const deployment = name === '' || name === 'none' ? null : (deployments[name] ?? null);
  if (name && name !== 'none' && !deployment) {
    throw new Error(
      `DEPLOYMENT="${name}" is not one of ${Object.keys(deployments).join(', ')} (or "none")`,
    );
  }

  const chainId = env.CHAIN_ID ? Number(env.CHAIN_ID) : deployment?.chainId;
  const chain = CHAINS.find((c) => c.id === chainId);
  if (!chain) {
    throw new Error(
      `Unknown chain ${chainId ?? '(none)'}: set CHAIN_ID to one of ${CHAINS.map((c) => c.id).join(', ')}`,
    );
  }

  const rpcUrl = env.RPC_URL || DEFAULT_RPC_URLS[chain.id] || chain.rpcUrls.default.http[0]!;
  const dailyDraw = optionalAddress(env, 'DAILY_DRAW_ADDRESS', deployment?.dailyDraw);
  if (!dailyDraw) throw new Error('Set DAILY_DRAW_ADDRESS (or DEPLOYMENT)');

  const subscription = bigintOr(
    env,
    'VRF_SUBSCRIPTION_ID',
    deployment ? BigInt(deployment.vrfSubscriptionId) : null,
  );
  const chunk = bigintOr(env, 'LOG_CHUNK_BLOCKS', 1_000_000n)!;

  return {
    chain,
    rpcUrl,
    deployment: deployment ? name : null,
    dailyDraw,
    usdc: optionalAddress(env, 'USDC_ADDRESS', deployment?.usdc),
    timelock: optionalAddress(env, 'TIMELOCK_ADDRESS', deployment?.timelock),
    startBlock: bigintOr(env, 'START_BLOCK', BigInt(deployment?.startBlock ?? 0))!,
    keeper: optionalAddress(env, 'KEEPER_ADDRESS', deployment?.keeper),
    vrfCoordinator: optionalAddress(env, 'VRF_COORDINATOR', deployment?.vrfCoordinator),
    vrfSubscriptionId: subscription,
    dripWallet: optionalAddress(env, 'DRIP_WALLET_ADDRESS'),
    logChunkBlocks: chunk > 0n ? chunk : 1_000_000n,
    thresholds: {
      keeperMinWei: decimal(env, 'KEEPER_MIN_ETH', '0.005'),
      dripMinWei: decimal(env, 'DRIP_MIN_ETH', '0.02'),
      vrfMinLink: decimal(env, 'VRF_MIN_LINK', '5'),
      vrfMinNative: decimal(env, 'VRF_MIN_NATIVE', '0.01'),
      closeGraceSeconds: minutes(env, 'CLOSE_GRACE_MINUTES', 45),
      randomnessGraceSeconds: minutes(env, 'RANDOMNESS_GRACE_MINUTES', 30),
      sweepWarnDays: Number(bigintOr(env, 'SWEEP_WARN_DAYS', 7n)),
    },
  };
}
