import type { TestnetDeployment } from '@daily-draw/contracts';
import { describe, expect, it } from 'vitest';
import { normalizePrivateKey, parseConfig } from './config.js';

const deployment = {
  network: 'base-sepolia',
  chainId: 84532,
  startBlock: 123,
  dailyDraw: '0x00000000000000000000000000000000000000d1',
  keeper: '0x9032f538d36fD201D019d11361FDBb1EE72D1034',
} as unknown as TestnetDeployment;
const read = (network: string) => {
  if (network !== 'base-sepolia') throw new Error(`no ${network}`);
  return deployment;
};
const KEY = 'ab'.repeat(32);

describe('parseConfig', () => {
  it('defaults to both tasks on Base Sepolia over the public RPC', () => {
    const c = parseConfig({ KEEPER_PRIVATE_KEY: KEY }, [], read);
    expect(c.rpcUrl).toBe('https://sepolia.base.org');
    expect(c.privateKey).toBe(`0x${KEY}`);
    expect(c.options).toEqual({ close: true, claim: true, dryRun: false, startBlock: 123n });
    expect(c.logChunkBlocks).toBe(9_000n);
  });

  it('reads flags and overrides', () => {
    const c = parseConfig(
      {
        KEEPER_PRIVATE_KEY: `0x${KEY}`,
        TESTNET_RPC_URL: 'https://rpc.example',
        LOG_CHUNK_BLOCKS: '500',
      },
      ['--only=claim', '--dry-run'],
      read,
    );
    expect(c.rpcUrl).toBe('https://rpc.example');
    expect(c.options).toMatchObject({ close: false, claim: true, dryRun: true });
    expect(c.logChunkBlocks).toBe(500n);
  });

  it('needs a key unless it is a dry run, and never echoes a bad key', () => {
    expect(() => parseConfig({}, [], read)).toThrow(/KEEPER_PRIVATE_KEY is not set/);
    const dry = parseConfig({}, ['--dry-run'], read);
    expect(dry.privateKey).toBeNull();
    expect(dry.keeperAddress).toBe(deployment.keeper);
    const secretish = 'deadbeef'.repeat(5);
    expect(() => normalizePrivateKey(secretish)).toThrow(/not a private key/);
    try {
      normalizePrivateKey(secretish);
    } catch (err) {
      expect(String(err)).not.toContain(secretish);
    }
  });

  it('rejects unknown tasks and missing deployments', () => {
    expect(() => parseConfig({ KEEPER_PRIVATE_KEY: KEY }, ['--only=sweep'], read)).toThrow(
      /Unknown keeper task "sweep"/,
    );
    expect(() =>
      parseConfig({ KEEPER_PRIVATE_KEY: KEY, TESTNET_NETWORK: 'celo-sepolia' }, [], read),
    ).toThrow(/no celo-sepolia/);
  });
});
