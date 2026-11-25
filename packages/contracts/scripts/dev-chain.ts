// `pnpm dev:chain`: start Anvil (docker compose) if it isn't running, deploy DevUSDC,
// DevRandomness and DailyDraw with script/DeployLocal.s.sol, and point the web app at them by
// writing apps/web/.env.local. Local play money only.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DevDeployment } from '../ts/index.js';
import { ANVIL_OPERATOR_KEY, RPC_URL } from './dev-env.js';

const contractsDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = join(contractsDir, '..', '..');

async function chainId(): Promise<number | undefined> {
  try {
    const res = await fetch(RPC_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }),
    });
    const body = (await res.json()) as { result: string };
    return Number(body.result);
  } catch {
    return undefined;
  }
}

async function ensureChain(): Promise<number> {
  let id = await chainId();
  if (id !== undefined) return id;
  if (!/\/\/(localhost|127\.0\.0\.1):8545/.test(RPC_URL)) {
    throw new Error(`No chain answering at ${RPC_URL}`);
  }
  console.log('Starting Anvil (docker compose up -d anvil)…');
  execFileSync('docker', ['compose', 'up', '-d', 'anvil'], { cwd: repoRoot, stdio: 'inherit' });
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 500));
    id = await chainId();
    if (id !== undefined) return id;
  }
  throw new Error('Anvil did not start on :8545');
}

/** Replace or add `KEY=value` lines, keeping everything else in the file. */
function mergeEnv(existing: string, values: Record<string, string>): string {
  const lines = existing.split('\n').filter((l, i, all) => l !== '' || i < all.length - 1);
  for (const [key, value] of Object.entries(values)) {
    const idx = lines.findIndex((l) => l.startsWith(`${key}=`));
    if (idx >= 0) lines[idx] = `${key}=${value}`;
    else lines.push(`${key}=${value}`);
  }
  return `${lines.join('\n')}\n`;
}

async function main() {
  const id = await ensureChain();
  console.log(`Chain ${id} at ${RPC_URL}. Deploying…`);
  mkdirSync(join(contractsDir, 'deployments'), { recursive: true });
  execFileSync(
    join(repoRoot, 'scripts', 'forge.sh'),
    [
      'script',
      'script/DeployLocal.s.sol',
      '--rpc-url',
      RPC_URL,
      '--broadcast',
      '--private-key',
      ANVIL_OPERATOR_KEY,
    ],
    { stdio: ['ignore', 'ignore', 'inherit'] },
  );
  const deployment = JSON.parse(
    readFileSync(join(contractsDir, 'deployments', `${id}.json`), 'utf8'),
  ) as DevDeployment;

  const envFile = join(repoRoot, 'apps', 'web', '.env.local');
  const existing = existsSync(envFile)
    ? readFileSync(envFile, 'utf8')
    : '# Written by `pnpm dev:chain`; other keys you add here are kept.\n';
  writeFileSync(
    envFile,
    mergeEnv(existing, {
      NEXT_PUBLIC_CHAIN: 'anvil',
      NEXT_PUBLIC_RPC_URL: RPC_URL,
      NEXT_PUBLIC_DAILY_DRAW_ADDRESS: deployment.dailyDraw,
      NEXT_PUBLIC_USDC_ADDRESS: deployment.usdc,
      NEXT_PUBLIC_START_BLOCK: String(deployment.startBlock),
      NEXT_PUBLIC_FAUCET: 'true',
    }),
  );

  console.log(`
DailyDraw   ${deployment.dailyDraw}
Test USDC   ${deployment.usdc}
Randomness  ${deployment.randomness} (operator ${deployment.operator})
Wrote apps/web/.env.local. Anvil accounts 1-5 hold $1,000 test USDC each.

Next: pnpm --filter @daily-draw/web dev, then pnpm chain status | close | draw [00-99].`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
