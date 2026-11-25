// Shared settings for the local-chain dev scripts. Anvil's well-known test keys: never fund them
// on a real network.
export const RPC_URL = process.env.RPC_URL ?? 'http://127.0.0.1:8545';

/** Anvil account 0: deploys, holds the admin roles and answers DevRandomness. */
export const ANVIL_OPERATOR_KEY =
  (process.env.OPERATOR_KEY as `0x${string}` | undefined) ??
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
