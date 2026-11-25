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
