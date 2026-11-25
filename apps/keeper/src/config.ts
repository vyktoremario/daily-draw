// Keeper settings from the environment (the repo's .env locally, GitHub secrets in Actions) and
// command-line flags. Error messages never include a private key.
import type { TestnetDeployment } from '@daily-draw/contracts';
import type { RunOptions } from './run.js';

export interface KeeperConfig {
  rpcUrl: string;
  /** Absent only in a dry run, which sends nothing. */
  privateKey: `0x${string}` | null;
  /** Used as the keeper address in a dry run without a key. */
  keeperAddress: `0x${string}`;
  network: string;
  deployment: TestnetDeployment;
  options: RunOptions;
  /** Largest block range per eth_getLogs request (halved automatically if the RPC refuses). */
  logChunkBlocks: bigint;
}

export type Env = Partial<Record<string, string | undefined>>;

export const DEFAULT_RPC_URLS: Record<number, string> = {
  84532: 'https://sepolia.base.org',
};

export function normalizePrivateKey(value: string): `0x${string}` {
  const key = value.trim().startsWith('0x') ? value.trim() : `0x${value.trim()}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) {
    throw new Error('KEEPER_PRIVATE_KEY is not a private key (expected 64 hex characters)');
  }
  return key as `0x${string}`;
}

export function parseConfig(
  env: Env,
  argv: readonly string[],
  readDeployment: (network: string) => TestnetDeployment,
): KeeperConfig {
  const flag = (name: string) => argv.includes(`--${name}`);
  const only = argv.find((a) => a.startsWith('--only='))?.slice('--only='.length);
  const tasks = (only ?? env.KEEPER_TASKS ?? 'close,claim').split(',').map((t) => t.trim());
  for (const t of tasks) {
    if (t !== 'close' && t !== 'claim') {
      throw new Error(`Unknown keeper task "${t}": use close, claim or close,claim`);
    }
  }
  const dryRun = flag('dry-run') || env.DRY_RUN === 'true';

  const network = env.TESTNET_NETWORK || 'base-sepolia';
  const deployment = readDeployment(network);

  const rpcUrl = env.TESTNET_RPC_URL || DEFAULT_RPC_URLS[deployment.chainId];
  if (!rpcUrl) throw new Error(`Set TESTNET_RPC_URL for chain ${deployment.chainId}`);

  const rawKey = env.KEEPER_PRIVATE_KEY ?? '';
  if (!rawKey && !dryRun) {
    throw new Error(
      'KEEPER_PRIVATE_KEY is not set (in .env locally, or as a GitHub Actions secret). ' +
        'Use --dry-run to only look.',
    );
  }
  const privateKey = rawKey ? normalizePrivateKey(rawKey) : null;
  const keeperAddress = (env.KEEPER_ADDRESS || deployment.keeper) as `0x${string}`;

  const chunk = env.LOG_CHUNK_BLOCKS ? BigInt(env.LOG_CHUNK_BLOCKS) : 9_000n;
  return {
    rpcUrl,
    privateKey,
    keeperAddress,
    network,
    deployment,
    options: {
      close: tasks.includes('close'),
      claim: tasks.includes('claim'),
      dryRun,
      startBlock: BigInt(deployment.startBlock),
    },
    logChunkBlocks: chunk > 0n ? chunk : 9_000n,
  };
}
