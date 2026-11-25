import { dailyDrawAbi } from '@daily-draw/contracts';
import { describe, expect, it } from 'vitest';
import {
  ContractFunctionExecutionError,
  ContractFunctionRevertedError,
  UserRejectedRequestError,
  encodeErrorResult,
} from 'viem';
import { friendlyError } from './errors';

function reverted(errorName: string, args: readonly unknown[]) {
  const data = encodeErrorResult({ abi: dailyDrawAbi, errorName, args } as never);
  const cause = new ContractFunctionRevertedError({
    abi: dailyDrawAbi,
    data,
    functionName: 'buyTickets',
  });
  return new ContractFunctionExecutionError(cause, {
    abi: dailyDrawAbi,
    functionName: 'buyTickets',
    args: [1n, [42], '0x0000000000000000000000000000000000000000'],
  });
}

describe('friendlyError', () => {
  it('explains the contract errors a player can hit', () => {
    expect(friendlyError(reverted('SalesClosed', [1n, 100n]))).toMatch(/Sales .* have closed/);
    expect(friendlyError(reverted('WalletLimitReached', [20n]))).toMatch(/20 tickets/);
    expect(
      friendlyError(reverted('AlreadyClaimed', [1n, '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'])),
    ).toMatch(/already claimed/);
  });

  it('names contract errors it has no message for', () => {
    expect(friendlyError(reverted('SweepTooEarly', [1n, 2n]))).toBe(
      'The contract refused: SweepTooEarly.',
    );
  });

  it('recognises a cancelled wallet prompt', () => {
    expect(friendlyError(new UserRejectedRequestError(new Error('User rejected')))).toBe(
      'You cancelled in your wallet.',
    );
  });

  it('falls back to the error message', () => {
    expect(friendlyError(new Error('boom'))).toBe('boom');
    expect(friendlyError('weird')).toBe('Something went wrong.');
  });
});
