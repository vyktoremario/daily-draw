// `pnpm testnet:info [--write-web-env]`: after `pnpm testnet:deploy`, print what to paste where:
// the VRF consumer for vrf.chain.link, the explorer links, and the web app's environment variables
// for Vercel. `--write-web-env` also writes them to apps/web/.env.local, to run the web app locally
// against the testnet. Reads the repo's .env for TESTNET_NETWORK and the WalletConnect id; never
// prints a private key.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { TestnetDeployment } from '../ts/index.js';

const contractsDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = join(contractsDir, '..', '..');

/**
 * Chain id → the web app's NEXT_PUBLIC_CHAIN key (apps/web/lib/config.ts), block explorer, and an
 * RPC for the browser. The app reads ticket and referral history with one eth_getLogs call from
 * the deployment block, so it needs an endpoint that accepts long block ranges: sepolia.base.org
 * refuses more than 200 blocks; Tenderly's public gateway accepted 10 million when tested
 * (2026-11-25). Until an indexer replaces those scans.
 */
const WEB_CHAINS: Record<number, { key: string; explorer: string; rpc?: string }> = {
  84532: {
    key: 'baseSepolia',
    explorer: 'https://sepolia.basescan.org',
    rpc: 'https://base-sepolia.gateway.tenderly.co',
  },
  11142220: { key: 'celoSepolia', explorer: 'https://celo-sepolia.blockscout.com' },
};

export function webEnv(
  d: TestnetDeployment,
  walletConnectProjectId: string,
): Record<string, string> {
  const chain = WEB_CHAINS[d.chainId];
  if (!chain) throw new Error(`The web app has no chain for id ${d.chainId}: add it to WEB_CHAINS`);
  return {
    NEXT_PUBLIC_CHAIN: chain.key,
    ...(chain.rpc ? { NEXT_PUBLIC_RPC_URL: chain.rpc } : {}),
    NEXT_PUBLIC_DAILY_DRAW_ADDRESS: d.dailyDraw,
    NEXT_PUBLIC_USDC_ADDRESS: d.usdc,
    NEXT_PUBLIC_START_BLOCK: String(d.startBlock),
    NEXT_PUBLIC_FAUCET: 'true',
    NEXT_PUBLIC_DEV_WALLETS: 'false',
    NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID: walletConnectProjectId,
  };
}

function main() {
  const envPath = join(repoRoot, '.env');
  if (existsSync(envPath)) process.loadEnvFile(envPath);
  const network = process.env.TESTNET_NETWORK || 'base-sepolia';
  const file = join(contractsDir, 'deployments', `${network}.json`);
  if (!existsSync(file)) {
    throw new Error(`No ${network} deployment (${file}). Run pnpm testnet:deploy first.`);
  }
  const d = JSON.parse(readFileSync(file, 'utf8')) as TestnetDeployment;
  const explorer = WEB_CHAINS[d.chainId]?.explorer;
  const link = (a: string) => (explorer ? `${explorer}/address/${a}` : a);
  const env = webEnv(d, process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? '');
  const cutoff = new Date(d.firstCutoff * 1000).toLocaleString('en-GB', {
    timeZone: 'Africa/Lagos',
    dateStyle: 'full',
    timeStyle: 'short',
  });

  console.log(`Daily Draw on ${network} (chain ${d.chainId})

  DailyDraw (proxy)   ${link(d.dailyDraw)}
  Test USDC           ${link(d.usdc)}
  VRF adapter         ${link(d.randomness)}
  Timelock            ${link(d.timelock)}  (delay ${d.timelockDelay / 3600} h)
  First cutoff        ${cutoff} WAT

1. vrf.chain.link > subscription ${d.vrfSubscriptionId.slice(0, 6)}…${d.vrfSubscriptionId.slice(-4)} > Add consumer:
   ${d.randomness}

2. Vercel > Project > Settings > Environment Variables (all environments):
${Object.entries(env)
  .map(([k, v]) => `   ${k}=${v}`)
  .join('\n')}
${env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ? '' : '   (WalletConnect id empty: browser wallets only. Optional.)\n'}`);

  if (process.argv.includes('--write-web-env')) {
    const target = join(repoRoot, 'apps', 'web', '.env.local');
    writeFileSync(
      target,
      `# Written by \`pnpm testnet:info --write-web-env\` (${network}).\n` +
        Object.entries(env)
          .map(([k, v]) => `${k}=${v}`)
          .join('\n') +
        '\n',
    );
    console.log(`Wrote ${target}`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}
