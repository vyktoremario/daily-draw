import { parseAbi } from 'viem';

/** Chainlink VRF v2.5 coordinator (the part the dashboard reads). */
export const vrfCoordinatorAbi = parseAbi([
  'function getSubscription(uint256 subId) view returns (uint96 balance, uint96 nativeBalance, uint64 reqCount, address subOwner, address[] consumers)',
]);

/** packages/contracts/src/randomness/ChainlinkVrfProvider.sol */
export const vrfProviderAbi = parseAbi([
  'function coordinator() view returns (address)',
  'function config() view returns (bytes32 keyHash, uint256 subscriptionId, uint16 requestConfirmations, uint32 callbackGasLimit, bool nativePayment)',
]);

/** OpenZeppelin TimelockController (the part the dashboard reads). */
export const timelockAbi = parseAbi([
  'event CallScheduled(bytes32 indexed id, uint256 indexed index, address target, uint256 value, bytes data, bytes32 predecessor, uint256 delay)',
  'function getTimestamp(bytes32 id) view returns (uint256)',
  'function getMinDelay() view returns (uint256)',
]);
