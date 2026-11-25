import { describe, expect, it } from 'vitest';
import { networkDetails, parseAppConfig } from './config';

const GAME = '0xdc64a140aa3e981100a9beca4e685f962f0cf6c9';

describe('parseAppConfig', () => {
  it('defaults to the local Anvil chain with faucet and dev wallets', () => {
    const c = parseAppConfig({ NEXT_PUBLIC_DAILY_DRAW_ADDRESS: GAME });
    expect(c.chain.id).toBe(31337);
    expect(c.dailyDraw).toBe('0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9');
    expect(c.usdc).toBeNull();
    expect(c.faucet).toBe(true);
    expect(c.devWallets).toBe(true);
    expect(c.walletConnectProjectId).toBeNull();
  });

  it('switches chain by config, with an RPC override', () => {
    const c = parseAppConfig({
      NEXT_PUBLIC_CHAIN: 'baseSepolia',
      NEXT_PUBLIC_RPC_URL: 'https://rpc.example',
      NEXT_PUBLIC_START_BLOCK: '123',
    });
    expect(c.chain.id).toBe(84532);
    expect(c.chain.rpcUrls.default.http[0]).toBe('https://rpc.example');
    expect(c.startBlock).toBe(123n);
    expect(c.isTestnet).toBe(true);
    expect(c.devWallets).toBe(false);
  });

  it('never shows the faucet on a mainnet', () => {
    expect(parseAppConfig({ NEXT_PUBLIC_CHAIN: 'celo', NEXT_PUBLIC_FAUCET: 'true' }).faucet).toBe(
      false,
    );
    expect(
      parseAppConfig({ NEXT_PUBLIC_CHAIN: 'celoSepolia', NEXT_PUBLIC_FAUCET: 'false' }).faucet,
    ).toBe(false);
  });

  it('rejects unknown chains and ignores bad addresses', () => {
    expect(() => parseAppConfig({ NEXT_PUBLIC_CHAIN: 'mars' })).toThrow(/not one of/);
    expect(parseAppConfig({ NEXT_PUBLIC_USDC_ADDRESS: 'nope' }).usdc).toBeNull();
  });
});

describe('networkDetails', () => {
  it('gives the public details for adding Base Sepolia by hand', () => {
    expect(networkDetails({ chainKey: 'baseSepolia' })).toEqual({
      name: 'Base Sepolia',
      chainId: 84532,
      rpcUrl: 'https://sepolia.base.org',
      symbol: 'ETH',
      explorer: 'https://sepolia.basescan.org',
    });
  });
});
