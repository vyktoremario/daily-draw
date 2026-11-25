import {
  BaseError,
  ContractFunctionRevertedError,
  InternalRpcError,
  UnknownRpcError,
  UserRejectedRequestError,
} from 'viem';

const MESSAGES: Record<string, string> = {
  SalesClosed: 'Sales for this draw have closed. Try tomorrow’s draw.',
  DrawNotOpen: 'This draw is no longer open.',
  WalletLimitReached: 'That would take you over 20 tickets for this draw.',
  InvalidBundle: 'Tickets come in bundles of 1, 2, 5 or 10.',
  InvalidNumber: 'Numbers go from 00 to 99.',
  EnforcedPause: 'The game is paused for maintenance. Your money is safe; try again later.',
  NothingToClaim: 'There is nothing to claim for this draw.',
  AlreadyClaimed: 'You have already claimed this prize.',
  DrawNotSettled: 'This draw has not been settled yet.',
  ERC20InsufficientBalance: 'Not enough USDC in your wallet.',
  ERC20InsufficientAllowance: 'USDC approval is too low. Approve again and retry.',
};

export const NO_GAS_MESSAGE = 'Not enough gas money (ETH) in your wallet for this network.';

export interface ErrorHints {
  /** The wallet had too little ETH for gas when the call was made. */
  lowGas?: boolean;
}

/**
 * A short, human message for a failed wallet or contract call. MetaMask mobile reports a
 * transaction it can't pay gas for as a bare "unknown RPC error"; `hints.lowGas` lets a caller
 * that knows the balance turn that into the gas message.
 */
export function friendlyError(error: unknown, hints: ErrorHints = {}): string {
  if (error instanceof BaseError) {
    if (error.walk((e) => e instanceof UserRejectedRequestError)) {
      return 'You cancelled in your wallet.';
    }
    const reverted = error.walk((e) => e instanceof ContractFunctionRevertedError);
    if (reverted instanceof ContractFunctionRevertedError) {
      const name = reverted.data?.errorName;
      if (name && MESSAGES[name]) return MESSAGES[name];
      if (name) return `The contract refused: ${name}.`;
    }
    if (/insufficient funds|exceeds balance|gas required exceeds/i.test(error.message)) {
      return NO_GAS_MESSAGE;
    }
    if (
      hints.lowGas &&
      error.walk((e) => e instanceof UnknownRpcError || e instanceof InternalRpcError)
    ) {
      return NO_GAS_MESSAGE;
    }
    return error.shortMessage;
  }
  if (error instanceof Error) return error.message;
  return 'Something went wrong.';
}
