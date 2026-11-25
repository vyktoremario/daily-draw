export * from './abi.js';

/** What `script/DeployLocal.s.sol` writes to `deployments/<chainId>.json`. */
export interface DevDeployment {
  chainId: number;
  /** A block at or before the deployment: where event scans can start. */
  startBlock: number;
  dailyDraw: `0x${string}`;
  usdc: `0x${string}`;
  randomness: `0x${string}`;
  timelock: `0x${string}`;
  /** Holds the admin roles and triggers DevRandomness. */
  operator: `0x${string}`;
}

/**
 * What `script/DeployTestnet.s.sol` writes to `deployments/<network>.json` (e.g.
 * `deployments/base-sepolia.json`). Read by the keeper (`apps/keeper`) and `pnpm testnet:info`.
 */
export interface TestnetDeployment {
  network: string;
  chainId: number;
  /** A block at or before the deployment: where event scans can start. */
  startBlock: number;
  /** Unix seconds. */
  deployedAt: number;
  /** The DailyDraw proxy: the address everything talks to. */
  dailyDraw: `0x${string}`;
  dailyDrawImplementation: `0x${string}`;
  /** Test USDC with a public faucet. */
  usdc: `0x${string}`;
  /** The Chainlink VRF v2.5 adapter: add it as a consumer of the VRF subscription. */
  randomness: `0x${string}`;
  timelock: `0x${string}`;
  /** Seconds. */
  timelockDelay: number;
  admin: `0x${string}`;
  keeper: `0x${string}`;
  /** Unix seconds. */
  firstCutoff: number;
  vrfCoordinator: `0x${string}`;
  vrfKeyHash: `0x${string}`;
  /** A decimal string: too large for a JavaScript number. */
  vrfSubscriptionId: string;
}
