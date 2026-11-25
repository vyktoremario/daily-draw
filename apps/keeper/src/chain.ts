// KeeperChain over viem: reads DailyDraw, scans TicketsBought logs, and sends the keeper's two
// transactions (simulated first, so a call that would revert is never sent).
import { dailyDrawAbi, type TestnetDeployment } from '@daily-draw/contracts';
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  type Chain,
  type PublicClient,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { baseSepolia, celoSepolia } from 'viem/chains';
import type { KeeperConfig } from './config.js';
import { smallerLogRange, type DrawState, type TicketPurchase } from './decide.js';
import type { KeeperChain } from './run.js';

const KNOWN_CHAINS: Record<number, Chain> = {
  [baseSepolia.id]: baseSepolia,
  [celoSepolia.id]: celoSepolia,
};

function chainFor(d: TestnetDeployment, rpcUrl: string): Chain {
  const base =
    KNOWN_CHAINS[d.chainId] ??
    defineChain({
      id: d.chainId,
      name: d.network,
      nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
      rpcUrls: { default: { http: [rpcUrl] } },
    });
  return { ...base, rpcUrls: { default: { http: [rpcUrl] } } };
}

export function createViemChain(config: KeeperConfig): KeeperChain {
  const chain = chainFor(config.deployment, config.rpcUrl);
  const transport = http(config.rpcUrl, { retryCount: 3, timeout: 30_000 });
  const pub = createPublicClient({ chain, transport }) as PublicClient;
  const account = config.privateKey ? privateKeyToAccount(config.privateKey) : null;
  const wallet = account ? createWalletClient({ chain, transport, account }) : null;
  const address = config.deployment.dailyDraw;
  const keeperAddress = account?.address ?? config.keeperAddress;
  const timestamps = new Map<bigint, bigint>();
  let chunk = config.logChunkBlocks;

  async function send(
    functionName: 'closeDraw' | 'claimFor',
    args: readonly [bigint] | readonly [`0x${string}`, bigint],
  ): Promise<`0x${string}`> {
    if (!wallet || !account) throw new Error('No KEEPER_PRIVATE_KEY: cannot send transactions');
    const { request } = await pub.simulateContract({
      account,
      address,
      abi: dailyDrawAbi,
      functionName,
      args,
    } as Parameters<typeof pub.simulateContract>[0]);
    const hash = await wallet.writeContract(request as Parameters<typeof wallet.writeContract>[0]);
    const receipt = await pub.waitForTransactionReceipt({ hash, timeout: 120_000 });
    if (receipt.status !== 'success') throw new Error(`transaction ${hash} reverted`);
    return hash;
  }

  return {
    keeperAddress,

    async latestBlock() {
      const b = await pub.getBlock({ blockTag: 'latest' });
      timestamps.set(b.number, b.timestamp);
      return { number: b.number, timestamp: b.timestamp };
    },

    async blockTimestamp(block) {
      const cached = timestamps.get(block);
      if (cached !== undefined) return cached;
      const { timestamp } = await pub.getBlock({ blockNumber: block });
      timestamps.set(block, timestamp);
      return timestamp;
    },

    currentDrawId: () =>
      pub.readContract({ address, abi: dailyDrawAbi, functionName: 'currentDrawId' }),

    async getDraw(id) {
      const d = await pub.readContract({
        address,
        abi: dailyDrawAbi,
        functionName: 'getDraw',
        args: [id],
      });
      return {
        id,
        status: d.status,
        cutoff: d.cutoff,
        winningNumber: d.winningNumber,
        winningTickets: d.winningTickets,
        claimedTickets: d.claimedTickets,
        settledAt: d.settledAt,
        closedAt: d.closedAt,
      } satisfies DrawState;
    },

    paused: () => pub.readContract({ address, abi: dailyDrawAbi, functionName: 'paused' }),

    async hasKeeperRole() {
      const role = await pub.readContract({
        address,
        abi: dailyDrawAbi,
        functionName: 'KEEPER_ROLE',
      });
      return pub.readContract({
        address,
        abi: dailyDrawAbi,
        functionName: 'hasRole',
        args: [role, keeperAddress],
      });
    },

    keeperBalance: () => pub.getBalance({ address: keeperAddress }),

    async ticketPurchases(drawId, fromBlock, toBlock) {
      const out: TicketPurchase[] = [];
      let from = fromBlock;
      while (from <= toBlock) {
        const to = from + chunk - 1n < toBlock ? from + chunk - 1n : toBlock;
        try {
          const logs = await pub.getContractEvents({
            address,
            abi: dailyDrawAbi,
            eventName: 'TicketsBought',
            args: { drawId },
            fromBlock: from,
            toBlock: to,
            strict: true,
          });
          for (const l of logs) out.push({ player: l.args.player, numbers: l.args.numbers });
          from = to + 1n;
        } catch (err) {
          // RPCs cap eth_getLogs ranges (sepolia.base.org: 200 blocks): retry the same stretch in
          // pieces of the size the error states, or half.
          const next = smallerLogRange(chunk, err);
          if (next === null) throw err;
          chunk = next;
        }
      }
      return out;
    },

    async claimableTickets(drawId, player) {
      const [tickets] = await pub.readContract({
        address,
        abi: dailyDrawAbi,
        functionName: 'claimable',
        args: [drawId, player],
      });
      return tickets;
    },

    closeDraw: (drawId) => send('closeDraw', [drawId]),
    claimFor: (player, drawId) => send('claimFor', [player, drawId]),
  };
}
