import { getAddress, isAddress, type Address, type Chain } from 'viem';
import { anvil, base, baseSepolia, celo, celoSepolia } from 'viem/chains';

/**
 * Chains the app knows. Adding one is a config change: add it here, deploy, and set
 * NEXT_PUBLIC_CHAIN plus the contract addresses (see apps/web/.env.example).
 */
export const CHAINS = {
  anvil,
  baseSepolia,
  celoSepolia,
  base,
  celo,
} as const satisfies Record<string, Chain>;

export type ChainKey = keyof typeof CHAINS;

/** Chains where test USDC (with a faucet) is used. */
const TEST_CHAINS: readonly ChainKey[] = ['anvil', 'baseSepolia', 'celoSepolia'];

export interface AppConfig {
  chainKey: ChainKey;
  chain: Chain;
  rpcUrl: string;
  dailyDraw: Address | null;
  usdc: Address | null;
  /** Where event scans start (the deployment block). */
  startBlock: bigint;
  isTestnet: boolean;
  /** Show the test USDC faucet. Never on a mainnet. */
  faucet: boolean;
  /** Offer Anvil's unlocked accounts as wallets (local chain only). */
  devWallets: boolean;
  walletConnectProjectId: string | null;
}

export type PublicEnv = Partial<Record<string, string | undefined>>;

function address(value: string | undefined): Address | null {
  return value && isAddress(value, { strict: false }) ? getAddress(value) : null;
}

export function parseAppConfig(env: PublicEnv): AppConfig {
  const requested = env.NEXT_PUBLIC_CHAIN ?? 'anvil';
  if (!(requested in CHAINS)) {
    throw new Error(
      `NEXT_PUBLIC_CHAIN="${requested}" is not one of ${Object.keys(CHAINS).join(', ')}`,
    );
  }
  const chainKey = requested as ChainKey;
  const base = CHAINS[chainKey];
  const rpcUrl = env.NEXT_PUBLIC_RPC_URL || base.rpcUrls.default.http[0]!;
  const chain: Chain = { ...base, rpcUrls: { default: { http: [rpcUrl] } } };
  const isTestnet = TEST_CHAINS.includes(chainKey);
  const startBlock = /^\d+$/.test(env.NEXT_PUBLIC_START_BLOCK ?? '')
    ? BigInt(env.NEXT_PUBLIC_START_BLOCK!)
    : 0n;
  return {
    chainKey,
    chain,
    rpcUrl,
    dailyDraw: address(env.NEXT_PUBLIC_DAILY_DRAW_ADDRESS),
    usdc: address(env.NEXT_PUBLIC_USDC_ADDRESS),
    startBlock,
    isTestnet,
    faucet: isTestnet && env.NEXT_PUBLIC_FAUCET !== 'false',
    devWallets: chainKey === 'anvil' && env.NEXT_PUBLIC_DEV_WALLETS !== 'false',
    walletConnectProjectId: env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || null,
  };
}

// Next.js only inlines NEXT_PUBLIC_* variables that are written out in full.
export const appConfig = parseAppConfig({
  NEXT_PUBLIC_CHAIN: process.env.NEXT_PUBLIC_CHAIN,
  NEXT_PUBLIC_RPC_URL: process.env.NEXT_PUBLIC_RPC_URL,
  NEXT_PUBLIC_DAILY_DRAW_ADDRESS: process.env.NEXT_PUBLIC_DAILY_DRAW_ADDRESS,
  NEXT_PUBLIC_USDC_ADDRESS: process.env.NEXT_PUBLIC_USDC_ADDRESS,
  NEXT_PUBLIC_START_BLOCK: process.env.NEXT_PUBLIC_START_BLOCK,
  NEXT_PUBLIC_FAUCET: process.env.NEXT_PUBLIC_FAUCET,
  NEXT_PUBLIC_DEV_WALLETS: process.env.NEXT_PUBLIC_DEV_WALLETS,
  NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID,
});

export interface NetworkDetails {
  name: string;
  chainId: number;
  /** The chain's public RPC, for a player adding the network to their wallet by hand. */
  rpcUrl: string;
  symbol: string;
  explorer: string | null;
}

/** What a player types into their wallet to add the app's network by hand. */
export function networkDetails(config: Pick<AppConfig, 'chainKey'> = appConfig): NetworkDetails {
  const chain = CHAINS[config.chainKey];
  return {
    name: chain.name,
    chainId: chain.id,
    rpcUrl: chain.rpcUrls.default.http[0]!,
    symbol: chain.nativeCurrency.symbol,
    explorer: chain.blockExplorers?.default.url ?? null,
  };
}

/** Anvil's default accounts 1-5 (0 operates the draw). Unlocked on Anvil only; test keys. */
export const ANVIL_ACCOUNTS: readonly Address[] = [
  '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
  '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC',
  '0x90F79bf6EB2c4f870365E785982E1f101E93b906',
  '0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65',
  '0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc',
];
