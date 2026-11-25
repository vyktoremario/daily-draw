import { describe, expect, it } from 'vitest';
import { authorize, credentialsFromEnv, parseBasicAuth, safeEqual } from './auth';
import { parseAdminConfig } from './config';
import { number2, percent, token18, usd, watDateTime } from './format';
import { scanLogs, smallerLogRange } from './logs';

const basic = (user: string, password: string) =>
  `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;

describe('auth', () => {
  const expected = { user: 'founder', password: 's3cret:with:colons' };

  it('parses basic auth, keeping colons in the password', () => {
    expect(parseBasicAuth(basic('founder', 's3cret:with:colons'))).toEqual(expected);
    expect(parseBasicAuth(null)).toBeNull();
    expect(parseBasicAuth('Bearer abc')).toBeNull();
    expect(parseBasicAuth('Basic !!!')).toBeNull();
    expect(parseBasicAuth(`Basic ${Buffer.from('nocolon').toString('base64')}`)).toBeNull();
  });

  it('allows the right credentials only', () => {
    expect(authorize(basic('founder', 's3cret:with:colons'), expected, false)).toBe('allow');
    expect(authorize(basic('founder', 'wrong'), expected, false)).toBe('challenge');
    expect(authorize(basic('other', 's3cret:with:colons'), expected, false)).toBe('challenge');
    expect(authorize(null, expected, false)).toBe('challenge');
  });

  it('stays closed without credentials, except in local development', () => {
    expect(authorize(null, null, false)).toBe('unconfigured');
    expect(authorize(null, null, true)).toBe('allow');
    expect(credentialsFromEnv({ ADMIN_USER: 'a' })).toBeNull();
    expect(credentialsFromEnv({ ADMIN_USER: 'a', ADMIN_PASSWORD: 'b' })).toEqual({
      user: 'a',
      password: 'b',
    });
  });

  it('compares strings of any length', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
    expect(safeEqual('', '')).toBe(true);
  });
});

describe('config', () => {
  it('defaults everything from the Base Sepolia deployment file', () => {
    const c = parseAdminConfig({});
    expect(c.chain.id).toBe(84532);
    expect(c.deployment).toBe('base-sepolia');
    expect(c.rpcUrl).toBe('https://base-sepolia.gateway.tenderly.co');
    expect(c.dailyDraw).toBe('0x5f953504743B7Da528A78A2CA4C3941cFda62ED9');
    expect(c.keeper).toBe('0x9032f538d36fD201D019d11361FDBb1EE72D1034');
    expect(c.startBlock).toBe(63260343n);
    expect(c.vrfSubscriptionId).toBe(
      5515456418613449602881860396047899730608824941507335107874301703688044582655n,
    );
    expect(c.dripWallet).toBeNull();
    expect(c.thresholds.keeperMinWei).toBe(5_000_000_000_000_000n);
    expect(c.thresholds.closeGraceSeconds).toBe(45 * 60);
  });

  it('lets env vars override the deployment', () => {
    const c = parseAdminConfig({
      RPC_URL: 'https://rpc.example',
      START_BLOCK: '5',
      DRIP_WALLET_ADDRESS: '0x00000000000000000000000000000000000000aa',
      KEEPER_MIN_ETH: '0.1',
      VRF_MIN_LINK: '2.5',
      CLOSE_GRACE_MINUTES: '10',
    });
    expect(c.rpcUrl).toBe('https://rpc.example');
    expect(c.startBlock).toBe(5n);
    expect(c.dripWallet).toBe('0x00000000000000000000000000000000000000AA');
    expect(c.thresholds.keeperMinWei).toBe(100_000_000_000_000_000n);
    expect(c.thresholds.vrfMinLink).toBe(2_500_000_000_000_000_000n);
    expect(c.thresholds.closeGraceSeconds).toBe(600);
  });

  it('works without a deployment file when given a chain and address', () => {
    const c = parseAdminConfig({
      DEPLOYMENT: 'none',
      CHAIN_ID: '31337',
      DAILY_DRAW_ADDRESS: '0x00000000000000000000000000000000000000aa',
    });
    expect(c.chain.id).toBe(31337);
    expect(c.rpcUrl).toBe('http://127.0.0.1:8545');
    expect(c.keeper).toBeNull();
    expect(c.vrfSubscriptionId).toBeNull();
    expect(c.startBlock).toBe(0n);
  });

  it('explains bad values', () => {
    expect(() => parseAdminConfig({ DEPLOYMENT: 'mars' })).toThrow(/DEPLOYMENT="mars"/);
    expect(() => parseAdminConfig({ DEPLOYMENT: 'none', CHAIN_ID: '31337' })).toThrow(
      /DAILY_DRAW_ADDRESS/,
    );
    expect(() => parseAdminConfig({ KEEPER_ADDRESS: 'nope' })).toThrow(/KEEPER_ADDRESS/);
    expect(() => parseAdminConfig({ START_BLOCK: '-1' })).toThrow(/START_BLOCK/);
    expect(() => parseAdminConfig({ CHAIN_ID: '1' })).toThrow(/Unknown chain 1/);
  });
});

describe('format', () => {
  it('formats USDC with cents and keeps dust visible', () => {
    expect(usd(19_800_000n)).toBe('$19.80');
    expect(usd(1_234_567_000_000n)).toBe('$1,234,567.00');
    expect(usd(2n)).toBe('$0.000002');
    expect(usd(-1_500_000n)).toBe('-$1.50');
    expect(usd(0n)).toBe('$0.00');
  });

  it('formats 18-decimal tokens', () => {
    expect(token18(15_000_000_000_000_000n, 'ETH')).toBe('0.015 ETH');
    expect(token18(10n ** 19n, 'LINK', 2)).toBe('10 LINK');
    expect(token18(1n, 'ETH')).toBe('<0.0001 ETH');
    expect(token18(0n, 'ETH')).toBe('0 ETH');
  });

  it('formats Lagos time, numbers and percentages', () => {
    // 19:45 UTC is 8:45pm in Lagos.
    expect(watDateTime(Date.UTC(2026, 10, 25, 19, 45) / 1000)).toBe('Wed 25 Nov, 8:45pm');
    expect(number2(7)).toBe('07');
    expect(percent(1_000)).toBe('10%');
    expect(percent(250)).toBe('2.5%');
  });
});

describe('logs', () => {
  const rpcError = (message: string) => Object.assign(new Error('RPC error'), { details: message });

  it('uses the limit the RPC states, else halves, and gives up on unrelated errors', () => {
    expect(smallerLogRange(9000n, rpcError('eth_getLogs is limited to a 200 range'))).toBe(200n);
    expect(smallerLogRange(9000n, rpcError('block range too large'))).toBe(4500n);
    expect(smallerLogRange(15n, rpcError('block range too large'))).toBeNull();
    expect(smallerLogRange(9000n, new Error('fetch failed: ECONNREFUSED'))).toBeNull();
  });

  it('scans in chunks, shrinking when refused, in block order', async () => {
    const calls: [bigint, bigint][] = [];
    const logs = await scanLogs(
      async (from, to) => {
        if (to - from + 1n > 200n) throw rpcError('eth_getLogs is limited to a 200 range');
        calls.push([from, to]);
        return [from];
      },
      1_000n,
      1_450n,
      1_000n,
    );
    expect(calls).toEqual([
      [1_000n, 1_199n],
      [1_200n, 1_399n],
      [1_400n, 1_450n],
    ]);
    expect(logs).toEqual([1_000n, 1_200n, 1_400n]);
  });

  it('returns nothing for an empty range', async () => {
    expect(await scanLogs(async () => [1], 10n, 9n, 100n)).toEqual([]);
  });
});
