// `pnpm chain <command>`: drive the local demo chain deployed by `pnpm dev:chain`.
//
//   status                 the open draw, the chain clock and the rollover
//   close                  move the chain clock to the cutoff (8:45pm WAT) and close the open draw
//   draw [NN]              close the open draw if needed, then answer its randomness with NN
//                          (00-99; random if left out)
//   faucet <address> [$]   mint test USDC (default $100)
//   warp <hours>           move the chain clock forward
//
// Anvil only: it moves time with anvil RPC methods and signs as Anvil account 0 (the operator).
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createPublicClient,
  createTestClient,
  createWalletClient,
  defineChain,
  formatUnits,
  getAddress,
  http,
  parseUnits,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { dailyDrawAbi, devRandomnessAbi, devUsdcAbi, type DevDeployment } from '../ts/index.js';
import { ANVIL_OPERATOR_KEY, RPC_URL } from './dev-env.js';

const STATUS = ['None', 'Open', 'Closed', 'Drawn', 'Settled', 'Voided', 'Swept'] as const;

const contractsDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const chain = defineChain({
  id: 31337,
  name: 'Anvil',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
});
const transport = http(RPC_URL);
const pub = createPublicClient({ chain, transport });
const test = createTestClient({ chain, transport, mode: 'anvil' });
const wallet = createWalletClient({
  chain,
  transport,
  account: privateKeyToAccount(ANVIL_OPERATOR_KEY),
});

function loadDeployment(): DevDeployment {
  try {
    return JSON.parse(
      readFileSync(join(contractsDir, 'deployments', `${chain.id}.json`), 'utf8'),
    ) as DevDeployment;
  } catch {
    throw new Error('No local deployment found: run `pnpm dev:chain` first.');
  }
}

const usd = (units: bigint) => `$${formatUnits(units, 6)}`;
const wat = (ts: bigint) =>
  new Date(Number(ts) * 1000).toLocaleString('en-GB', {
    timeZone: 'Africa/Lagos',
    dateStyle: 'medium',
    timeStyle: 'short',
  }) + ' WAT';

async function chainNow(): Promise<bigint> {
  return (await pub.getBlock()).timestamp;
}

async function warpTo(ts: bigint) {
  const now = await chainNow();
  if (ts > now) {
    await test.increaseTime({ seconds: Number(ts - now) });
    await test.mine({ blocks: 1 });
  }
}

async function send(hash: Promise<`0x${string}`>) {
  const receipt = await pub.waitForTransactionReceipt({ hash: await hash });
  if (receipt.status !== 'success')
    throw new Error(`Transaction ${receipt.transactionHash} failed`);
}

async function status(d: DevDeployment) {
  const id = await pub.readContract({
    address: d.dailyDraw,
    abi: dailyDrawAbi,
    functionName: 'currentDrawId',
  });
  const draw = await pub.readContract({
    address: d.dailyDraw,
    abi: dailyDrawAbi,
    functionName: 'getDraw',
    args: [id],
  });
  const rollover = await pub.readContract({
    address: d.dailyDraw,
    abi: dailyDrawAbi,
    functionName: 'rollover',
  });
  console.log(`Chain time   ${wat(await chainNow())}`);
  console.log(`Draw #${id}     ${STATUS[draw.status]}, cutoff ${wat(draw.cutoff)}`);
  console.log(`Tickets      ${draw.ticketCount}, sales ${usd(draw.sales)}, fees ${usd(draw.fees)}`);
  console.log(`Rollover     ${usd(rollover)}`);
  if (id > 1n) {
    const last = await pub.readContract({
      address: d.dailyDraw,
      abi: dailyDrawAbi,
      functionName: 'getDraw',
      args: [id - 1n],
    });
    const n = String(last.winningNumber).padStart(2, '0');
    console.log(
      `Draw #${id - 1n}     ${STATUS[last.status]}` +
        (last.status >= 3 ? `, number ${n}, ${last.winningTickets} winning ticket(s)` : ''),
    );
  }
}

async function close(d: DevDeployment): Promise<bigint> {
  const id = await pub.readContract({
    address: d.dailyDraw,
    abi: dailyDrawAbi,
    functionName: 'currentDrawId',
  });
  const draw = await pub.readContract({
    address: d.dailyDraw,
    abi: dailyDrawAbi,
    functionName: 'getDraw',
    args: [id],
  });
  await warpTo(draw.cutoff);
  await send(
    wallet.writeContract({
      address: d.dailyDraw,
      abi: dailyDrawAbi,
      functionName: 'closeDraw',
      args: [id],
    }),
  );
  console.log(`Closed draw #${id} (${draw.ticketCount} tickets). Draw #${id + 1n} is open.`);
  return id;
}

async function draw(d: DevDeployment, number?: string) {
  let value: bigint;
  if (number === undefined) value = BigInt(Math.floor(Math.random() * 100));
  else if (/^\d{1,2}$/.test(number)) value = BigInt(number);
  else throw new Error(`Expected a number from 00 to 99, got "${number}"`);

  // Answer the newest closed draw that is still waiting, else close the open one first.
  const current = await pub.readContract({
    address: d.dailyDraw,
    abi: dailyDrawAbi,
    functionName: 'currentDrawId',
  });
  let drawId = current - 1n;
  const previous =
    drawId > 0n
      ? await pub.readContract({
          address: d.dailyDraw,
          abi: dailyDrawAbi,
          functionName: 'getDraw',
          args: [drawId],
        })
      : undefined;
  if (previous?.status !== 2) drawId = await close(d);

  const { requestId } = await pub.readContract({
    address: d.dailyDraw,
    abi: dailyDrawAbi,
    functionName: 'getDraw',
    args: [drawId],
  });
  // DevRandomness answers on the hour, like the real 9pm draw: 15 minutes after the cutoff.
  const { cutoff } = await pub.readContract({
    address: d.dailyDraw,
    abi: dailyDrawAbi,
    functionName: 'getDraw',
    args: [drawId],
  });
  await warpTo(cutoff + 15n * 60n);
  await send(
    wallet.writeContract({
      address: d.randomness,
      abi: devRandomnessAbi,
      functionName: 'fulfill',
      args: [requestId, value],
    }),
  );
  const settled = await pub.readContract({
    address: d.dailyDraw,
    abi: dailyDrawAbi,
    functionName: 'getDraw',
    args: [drawId],
  });
  const n = String(settled.winningNumber).padStart(2, '0');
  console.log(
    `Draw #${drawId}: number ${n}, pool ${usd(settled.pool)}, ${settled.winningTickets} winning ticket(s)` +
      (settled.winningTickets > 0 ? `, ${usd(settled.prizePerTicket)} each` : ' (pool rolls over)'),
  );
}

async function faucet(d: DevDeployment, to?: string, dollars = '100') {
  if (!to) throw new Error('Usage: pnpm chain faucet <address> [dollars]');
  const address = getAddress(to);
  await send(
    wallet.writeContract({
      address: d.usdc,
      abi: devUsdcAbi,
      functionName: 'mint',
      args: [address, parseUnits(dollars, 6)],
    }),
  );
  const balance = await pub.readContract({
    address: d.usdc,
    abi: devUsdcAbi,
    functionName: 'balanceOf',
    args: [address],
  });
  console.log(`${address} now holds ${usd(balance)} test USDC.`);
}

async function main() {
  const [command = 'status', ...args] = process.argv.slice(2);
  const d = loadDeployment();
  switch (command) {
    case 'status':
      return status(d);
    case 'close':
      await close(d);
      return;
    case 'draw':
      return draw(d, args[0]);
    case 'faucet':
      return faucet(d, args[0], args[1]);
    case 'warp': {
      const hours = Number(args[0]);
      if (!Number.isFinite(hours) || hours <= 0) throw new Error('Usage: pnpm chain warp <hours>');
      await warpTo((await chainNow()) + BigInt(Math.round(hours * 3600)));
      console.log(`Chain time is now ${wat(await chainNow())}.`);
      return;
    }
    default:
      throw new Error(`Unknown command "${command}". Try status, close, draw [NN], faucet, warp.`);
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
