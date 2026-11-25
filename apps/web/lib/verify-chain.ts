'use client';

import { useQuery } from '@tanstack/react-query';
import { parseEventLogs, type Address, type Hash, type PublicClient } from 'viem';
import { usePublicClient } from 'wagmi';
import { appConfig } from './config';
import { CONFIGURED, DrawStatus, GAME, type Draw } from './game';
import {
  proofsFromInput,
  randomnessProviderAbi,
  rolloverBefore,
  verifyDraw,
  vrfCoordinatorAbi,
  type PurchaseEvent,
  type RolloverEvent,
  type Verification,
  type VrfEvidence,
} from './verify';

/** Where the random number came from, with the transactions to look at on the explorer. */
export interface RandomnessTrail {
  requestId: bigint;
  requestTx: Hash;
  /** The provider that asked for the number (Chainlink VRF adapter on testnet). */
  provider?: Address;
  /** The VRF coordinator, when the provider is Chainlink. */
  coordinator?: Address;
  keyHash?: Hash;
  subscriptionId?: bigint;
  fulfilTx?: Hash;
}

export interface DrawEvidence {
  purchases: (PurchaseEvent & { txHash: Hash })[];
  trail?: RandomnessTrail;
  rolloverIn?: bigint;
  vrf?: VrfEvidence;
  verification?: Verification;
}

/** Everything the verify page needs, read from public chain data in the browser. */
async function loadEvidence(
  client: PublicClient,
  drawId: bigint,
  draw: Draw,
): Promise<DrawEvidence> {
  const fromBlock = appConfig.startBlock;
  const bought = await client.getContractEvents({
    ...GAME,
    eventName: 'TicketsBought',
    args: { drawId },
    fromBlock,
  });
  const purchases = bought.map((log) => ({
    player: log.args.player!,
    numbers: [...log.args.numbers!],
    price: log.args.price!,
    fee: log.args.fee!,
    txHash: log.transactionHash,
  }));
  if (draw.status < DrawStatus.Closed) return { purchases };

  // The request: DrawClosed, and in the same transaction the provider's and coordinator's events.
  const [closed] = await client.getContractEvents({
    ...GAME,
    eventName: 'DrawClosed',
    args: { drawId },
    fromBlock,
  });
  if (!closed) return { purchases };
  const closeReceipt = await client.getTransactionReceipt({ hash: closed.transactionHash });
  const requested = parseEventLogs({
    abi: vrfCoordinatorAbi,
    eventName: 'RandomWordsRequested',
    logs: closeReceipt.logs,
  }).find((l) => l.args.requestId === draw.requestId);
  const providerLog = parseEventLogs({
    abi: randomnessProviderAbi,
    eventName: 'RandomnessRequested',
    logs: closeReceipt.logs,
  }).find((l) => l.args.requestId === draw.requestId);
  const trail: RandomnessTrail = {
    requestId: draw.requestId,
    requestTx: closed.transactionHash,
    provider: providerLog?.address,
    coordinator: requested?.address,
    keyHash: requested?.args.keyHash,
    subscriptionId: requested?.args.subId,
  };

  const settledStatus = draw.status === DrawStatus.Settled || draw.status === DrawStatus.Swept;
  if (!settledStatus) return { purchases, trail };

  // The answer: the same transaction delivers the word, picks the number and settles the pool.
  const [settled] = await client.getContractEvents({
    ...GAME,
    eventName: 'DrawSettled',
    args: { drawId },
    fromBlock,
  });
  if (!settled) return { purchases, trail };
  const [settleReceipt, settleTx, history, swept] = await Promise.all([
    client.getTransactionReceipt({ hash: settled.transactionHash }),
    client.getTransaction({ hash: settled.transactionHash }),
    client.getContractEvents({
      ...GAME,
      eventName: 'DrawSettled',
      fromBlock,
      toBlock: settled.blockNumber,
    }),
    client.getContractEvents({
      ...GAME,
      eventName: 'UnclaimedSwept',
      fromBlock,
      toBlock: settled.blockNumber,
    }),
  ]);
  trail.fulfilTx = settled.transactionHash;

  const delivered = parseEventLogs({
    abi: randomnessProviderAbi,
    eventName: 'RandomnessFulfilled',
    logs: settleReceipt.logs,
  }).find((l) => l.args.requestId === draw.requestId);
  const fulfilled = parseEventLogs({
    abi: vrfCoordinatorAbi,
    eventName: 'RandomWordsFulfilled',
    logs: settleReceipt.logs,
  }).find((l) => l.args.requestId === draw.requestId);
  if (!delivered) return { purchases, trail };

  const order = (l: { blockNumber: bigint; logIndex: number }) =>
    l.blockNumber * 1_000_000n + BigInt(l.logIndex);
  const rolloverEvents = [
    ...history.map((l) => ({
      at: order(l),
      e: { kind: 'settled', drawId: l.args.drawId!, rolloverOut: l.args.rolloverOut! } as const,
    })),
    ...swept.map((l) => ({
      at: order(l),
      e: { kind: 'swept', drawId: l.args.drawId!, amount: l.args.amount! } as const,
    })),
  ]
    .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0))
    .map((x): RolloverEvent => x.e);
  const rolloverIn = rolloverBefore(rolloverEvents, drawId);

  const vrf: VrfEvidence = {
    requestId: draw.requestId,
    delivered: delivered.args.value,
    provider: delivered.address,
    request: requested && {
      requestId: requested.args.requestId,
      keyHash: requested.args.keyHash,
      preSeed: requested.args.preSeed,
      sender: requested.args.sender,
    },
    fulfilled: fulfilled && {
      outputSeed: fulfilled.args.outputSeed,
      success: fulfilled.args.success,
    },
    proofs: proofsFromInput(settleTx.input),
  };
  const p = draw.params;
  const s = settled.args;
  const verification = verifyDraw({
    numberRange: p.numberRange,
    ticketPrice: p.ticketPrice,
    feeBps: p.feeBps,
    split: {
      winnersBps: p.winnersBps,
      teamBps: p.teamBps,
      buybackBps: p.buybackBps,
      referrersBps: p.referrersBps,
    },
    purchases,
    rolloverIn,
    vrf,
    recorded: {
      winningNumber: draw.winningNumber,
      winningTickets: draw.winningTickets,
      ticketCount: draw.ticketCount,
      sales: draw.sales,
      fees: s.fees!,
      pool: s.pool!,
      prizePerTicket: s.prizePerTicket!,
      referralSharePerTicket: s.referralSharePerTicket!,
      team: s.team!,
      buyback: s.buyback!,
      rolloverOut: s.rolloverOut!,
    },
  });
  return { purchases, trail, rolloverIn, vrf, verification };
}

export function useDrawEvidence(drawId: bigint | undefined, draw: Draw | undefined) {
  const client = usePublicClient();
  return useQuery({
    queryKey: ['verify', appConfig.chain.id, drawId?.toString(), draw?.status],
    enabled: CONFIGURED && !!client && drawId !== undefined && !!draw && draw.status > 0,
    queryFn: () => loadEvidence(client!, drawId!, draw!),
    staleTime: 60_000,
  });
}

/** Explorer link for a transaction or address, or null on a chain without an explorer. */
export function explorerUrl(kind: 'tx' | 'address', value: string): string | null {
  const base = appConfig.chain.blockExplorers?.default.url;
  return base ? `${base}/${kind}/${value}` : null;
}
