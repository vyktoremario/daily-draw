'use client';

import { dailyDrawAbi, devUsdcAbi } from '@daily-draw/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';
import { zeroAddress, type Address, type ContractFunctionReturnType, type Hash } from 'viem';
import { useBytecode, useConfig, useConnection, usePublicClient, useReadContract } from 'wagmi';
import { waitForTransactionReceipt } from 'wagmi/actions';
import { appConfig } from './config';
import { friendlyError, type ErrorHints } from './errors';
import { chainClockOffset } from './time';

/** `DailyDraw.Status` */
export const DrawStatus = {
  None: 0,
  Open: 1,
  Closed: 2,
  Drawn: 3,
  Settled: 4,
  Voided: 5,
  Swept: 6,
} as const;

export type Draw = ContractFunctionReturnType<typeof dailyDrawAbi, 'view', 'getDraw'>;

/** True once the app has contract addresses to talk to. */
export const CONFIGURED = appConfig.dailyDraw !== null && appConfig.usdc !== null;
export const GAME = { address: appConfig.dailyDraw ?? zeroAddress, abi: dailyDrawAbi } as const;
export const USDC = { address: appConfig.usdc ?? zeroAddress, abi: devUsdcAbi } as const;

/** Whether the game contract exists on the chain (a restarted Anvil loses it). */
export function useDeployed(): boolean | undefined {
  const { data, isSuccess } = useBytecode({
    address: GAME.address,
    query: { enabled: CONFIGURED, refetchInterval: 30_000 },
  });
  return isSuccess ? data !== undefined && data !== '0x' : undefined;
}

/** Unix seconds by the chain's clock, ticking every second. */
export function useChainNow(): number {
  const client = usePublicClient();
  const { data: offset = 0 } = useQuery({
    queryKey: ['chain-clock-offset', appConfig.chain.id],
    queryFn: async () => chainClockOffset((await client!.getBlock()).timestamp, Date.now()),
    enabled: !!client,
    refetchInterval: 15_000,
  });
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const timer = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(timer);
  }, []);
  return now + offset;
}

export function useDraw(drawId: bigint | undefined) {
  return useReadContract({
    ...GAME,
    functionName: 'getDraw',
    args: [drawId ?? 0n],
    query: { enabled: CONFIGURED && drawId !== undefined && drawId > 0n },
  });
}

/** The open draw, the one before it, and the rollover. */
export function useGame() {
  const { data: currentId } = useReadContract({
    ...GAME,
    functionName: 'currentDrawId',
    query: { enabled: CONFIGURED },
  });
  const { data: current } = useDraw(currentId);
  const { data: previous } = useDraw(currentId !== undefined ? currentId - 1n : undefined);
  const { data: rollover } = useReadContract({
    ...GAME,
    functionName: 'rollover',
    query: { enabled: CONFIGURED },
  });
  return { currentId, current, previous, rollover };
}

/** The last `count` draws before the open one, newest first. */
export function useRecentDraws(currentId: bigint | undefined, count = 14) {
  const client = usePublicClient();
  return useQuery({
    queryKey: ['recent-draws', appConfig.chain.id, currentId?.toString(), count],
    enabled: !!client && currentId !== undefined,
    queryFn: async () => {
      const ids: bigint[] = [];
      for (let id = currentId! - 1n; id >= 1n && ids.length < count; id--) ids.push(id);
      const draws = await Promise.all(
        ids.map((id) => client!.readContract({ ...GAME, functionName: 'getDraw', args: [id] })),
      );
      return ids.map((id, i) => ({ id, draw: draws[i]! }));
    },
  });
}

export interface Purchase {
  drawId: bigint;
  numbers: number[];
  price: bigint;
  fee: bigint;
  txHash: Hash;
  blockNumber: bigint;
}

/** Every ticket purchase by `player`, from the contract's events, newest first. */
export function usePurchases(player: Address | undefined) {
  const client = usePublicClient();
  return useQuery({
    queryKey: ['purchases', appConfig.chain.id, player],
    enabled: !!client && !!player && CONFIGURED,
    queryFn: async (): Promise<Purchase[]> => {
      const logs = await client!.getContractEvents({
        ...GAME,
        eventName: 'TicketsBought',
        args: { player },
        fromBlock: appConfig.startBlock,
      });
      return logs
        .map((log) => ({
          drawId: log.args.drawId!,
          numbers: [...log.args.numbers!],
          price: log.args.price!,
          fee: log.args.fee!,
          txHash: log.transactionHash,
          blockNumber: log.blockNumber,
        }))
        .reverse();
    },
  });
}

/** All numbers `player` holds in `drawId` (repeats included). */
export function numbersInDraw(
  purchases: readonly Purchase[] | undefined,
  drawId: bigint,
): number[] {
  return (purchases ?? []).filter((p) => p.drawId === drawId).flatMap((p) => p.numbers);
}

/** Winning tickets the connected player can still claim in `drawId`, and whether they claimed. */
export function usePrize(drawId: bigint | undefined, player: Address | undefined) {
  const enabled = CONFIGURED && drawId !== undefined && !!player;
  const claimable = useReadContract({
    ...GAME,
    functionName: 'claimable',
    args: [drawId ?? 0n, player ?? zeroAddress],
    query: { enabled },
  });
  const claimed = useReadContract({
    ...GAME,
    functionName: 'claimed',
    args: [drawId ?? 0n, player ?? zeroAddress],
    query: { enabled },
  });
  const [tickets = 0n, prize = 0n] = claimable.data ?? [];
  return { tickets, prize, claimed: claimed.data ?? false };
}

export function useUsdcBalance(player: Address | undefined) {
  return useReadContract({
    ...USDC,
    functionName: 'balanceOf',
    args: [player ?? zeroAddress],
    query: { enabled: CONFIGURED && !!player },
  });
}

/** Connected wallet, and whether it is on the app's chain. */
export function usePlayer() {
  const { address, chainId, isConnected, connector } = useConnection();
  return {
    address,
    isConnected,
    connector,
    wrongChain: isConnected && chainId !== appConfig.chain.id,
  };
}

export type TxPhase = 'idle' | 'wallet' | 'pending' | 'done' | 'error';
export interface TxState {
  phase: TxPhase;
  label?: string;
  hash?: Hash;
  error?: string;
}

/**
 * Runs one or more transactions in sequence (approve, then buy), tracking which step is waiting
 * for the wallet or the chain. Refreshes every read once they are all mined.
 */
export function useTransactions() {
  const config = useConfig();
  const queryClient = useQueryClient();
  const [state, setState] = useState<TxState>({ phase: 'idle' });

  const step = useCallback(
    async (label: string, write: () => Promise<Hash>) => {
      setState({ phase: 'wallet', label });
      const hash = await write();
      setState({ phase: 'pending', label, hash });
      const receipt = await waitForTransactionReceipt(config, { hash });
      if (receipt.status !== 'success') throw new Error(`${label} failed on chain.`);
      return receipt;
    },
    [config],
  );

  const run = useCallback(
    async (
      flow: (s: typeof step) => Promise<Hash | void>,
      hints?: ErrorHints,
    ): Promise<Hash | false> => {
      try {
        const hash = (await flow(step)) ?? undefined;
        setState({ phase: 'done', hash });
        await queryClient.invalidateQueries();
        return hash ?? '0x';
      } catch (error) {
        setState({ phase: 'error', error: friendlyError(error, hints) });
        return false;
      }
    },
    [queryClient, step],
  );

  const reset = useCallback(() => setState({ phase: 'idle' }), []);
  const busy = state.phase === 'wallet' || state.phase === 'pending';
  return { state, run, reset, busy };
}

/** "Confirm in your wallet…" / "Approving USDC…" */
export function txMessage(state: TxState): string | null {
  if (state.phase === 'wallet') return `${state.label}: confirm in your wallet…`;
  if (state.phase === 'pending') return `${state.label}: waiting for the network…`;
  if (state.phase === 'error') return state.error ?? 'Something went wrong.';
  return null;
}
