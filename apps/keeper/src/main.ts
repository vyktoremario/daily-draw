// `pnpm keeper [--dry-run] [--only=close|claim]`: one keeper pass against the testnet deployment
// (packages/contracts/deployments/<TESTNET_NETWORK>.json). Runs on a GitHub Actions schedule
// (.github/workflows/keeper.yml) and locally. Exits 1 if anything it tried failed.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { TestnetDeployment } from '@daily-draw/contracts';
import { createViemChain } from './chain.js';
import { parseConfig } from './config.js';
import { runKeeper, type Logger } from './run.js';

const deploymentsDir = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'packages',
  'contracts',
  'deployments',
);

function readDeployment(network: string): TestnetDeployment {
  const file = join(deploymentsDir, `${network}.json`);
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as TestnetDeployment;
  } catch {
    throw new Error(`No deployment file at ${file}: run pnpm testnet:deploy and commit it.`);
  }
}

/** Plain timestamped lines; in GitHub Actions, warnings and errors also become annotations. */
function consoleLogger(): Logger {
  const gh = process.env.GITHUB_ACTIONS === 'true';
  const stamp = () => new Date().toISOString();
  return {
    info: (m) => console.log(`${stamp()} ${m}`),
    warn: (m) => console.log(gh ? `::warning::${m}` : `${stamp()} WARNING ${m}`),
    error: (m) => console.log(gh ? `::error::${m}` : `${stamp()} ERROR ${m}`),
  };
}

async function main() {
  const log = consoleLogger();
  const config = parseConfig(process.env, process.argv.slice(2), readDeployment);
  log.info(`Daily Draw keeper on ${config.network}, DailyDraw ${config.deployment.dailyDraw}`);
  const summary = await runKeeper(createViemChain(config), config.options, log);
  if (summary.failures.length > 0) process.exitCode = 1;
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
