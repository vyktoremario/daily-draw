import { describe, expect, it, vi } from 'vitest';
import { parseEther, type Address, type Hash } from 'viem';
import { base, baseSepolia } from 'viem/chains';
import {
  DEFAULT_DRIP,
  dripStatus,
  dripStatusCode,
  memoryDripStore,
  parseDripBody,
  parseDripSettings,
  runDrip,
  toGwei,
  type DripChain,
  type DripDeps,
  type DripStore,
} from './drip';

const PLAYER = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' as Address;
const OTHER = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC' as Address;
const HASH = `0x${'ab'.repeat(32)}` as Hash;
const NOW = new Date('2026-11-25T12:00:00Z');

function fakeChain(overrides: Partial<DripChain> = {}) {
  const sent: [Address, bigint][] = [];
  const chain: DripChain = {
    chainId: async () => baseSepolia.id,
    balance: async () => 0n,
    dripBalance: async () => parseEther('1'),
    send: async (to, wei) => {
      sent.push([to, wei]);
      return HASH;
    },
    ...overrides,
  };
  return { chain, sent };
}

function deps(overrides: Partial<DripDeps> = {}): DripDeps {
  return {
    settings: DEFAULT_DRIP,
    configTestnet: true,
    store: memoryDripStore(),
    chain: fakeChain().chain,
    now: () => NOW,
    sleep: async () => {},
    ...overrides,
  };
}

describe('runDrip', () => {
  it('sends the configured amount to a wallet with no gas', async () => {
    const { chain, sent } = fakeChain();
    const result = await runDrip(PLAYER, '1.1.1.1', deps({ chain }));
    expect(result).toEqual({ ok: true, hash: HASH, amountWei: parseEther('0.0005') });
    expect(sent).toEqual([[PLAYER, parseEther('0.0005')]]);
  });

  it('only drips below the balance threshold', async () => {
    const { chain, sent } = fakeChain({ balance: async () => parseEther('0.0001') });
    expect(await runDrip(PLAYER, '1.1.1.1', deps({ chain }))).toEqual({
      ok: false,
      reason: 'has-gas',
    });
    expect(sent).toHaveLength(0);

    const low = fakeChain({ balance: async () => parseEther('0.00009') });
    expect((await runDrip(PLAYER, '1.1.1.1', deps({ chain: low.chain }))).ok).toBe(true);
  });

  it('drips once per address, whatever its case', async () => {
    const d = deps();
    expect((await runDrip(PLAYER, '1.1.1.1', d)).ok).toBe(true);
    expect(await runDrip(PLAYER, '2.2.2.2', d)).toEqual({ ok: false, reason: 'already-dripped' });
    const lower = PLAYER.toLowerCase() as Address;
    expect(await runDrip(lower, '3.3.3.3', d)).toEqual({ ok: false, reason: 'already-dripped' });
  });

  it('stops at the daily cap and resets the next UTC day', async () => {
    const settings = { ...DEFAULT_DRIP, dailyCapWei: parseEther('0.001') };
    let now = NOW;
    const d = deps({ settings, now: () => now });
    const addresses = Array.from(
      { length: 4 },
      (_, i) => `0x${(i + 1).toString(16).padStart(40, '0')}` as Address,
    );
    expect((await runDrip(addresses[0]!, 'a', d)).ok).toBe(true);
    expect((await runDrip(addresses[1]!, 'b', d)).ok).toBe(true);
    expect(await runDrip(addresses[2]!, 'c', d)).toEqual({ ok: false, reason: 'daily-cap' });
    // The refused drip isn't counted and the address can try again tomorrow.
    expect((d.store as ReturnType<typeof memoryDripStore>).days.get('2026-11-25')).toBe(
      toGwei(parseEther('0.001')),
    );
    now = new Date('2026-11-26T00:00:01Z');
    expect((await runDrip(addresses[2]!, 'c', d)).ok).toBe(true);
  });

  it('limits requests per IP per day', async () => {
    const settings = { ...DEFAULT_DRIP, perIpDaily: 2 };
    const d = deps({ settings });
    expect((await runDrip(PLAYER, '9.9.9.9', d)).ok).toBe(true);
    expect((await runDrip(OTHER, '9.9.9.9', d)).ok).toBe(true);
    const third = '0x90F79bf6EB2c4f870365E785982E1f101E93b906' as Address;
    expect(await runDrip(third, '9.9.9.9', d)).toEqual({ ok: false, reason: 'ip-limit' });
    expect((await runDrip(third, '8.8.8.8', d)).ok).toBe(true);
  });

  it('runs on testnets only, by config and by the RPC’s chain id', async () => {
    expect(await runDrip(PLAYER, 'a', deps({ configTestnet: false }))).toEqual({
      ok: false,
      reason: 'not-testnet',
    });
    const { chain, sent } = fakeChain({ chainId: async () => base.id });
    expect(await runDrip(PLAYER, 'a', deps({ chain }))).toEqual({
      ok: false,
      reason: 'not-testnet',
    });
    expect(sent).toHaveLength(0);
  });

  it('refuses a missing or bad address', async () => {
    expect(await runDrip(null, 'a', deps())).toEqual({ ok: false, reason: 'bad-request' });
  });

  it('refuses (never sends unlimited) without a store or a drip key', async () => {
    const { chain, sent } = fakeChain();
    expect(await runDrip(PLAYER, 'a', deps({ store: null, chain }))).toEqual({
      ok: false,
      reason: 'unavailable',
    });
    expect(await runDrip(PLAYER, 'a', deps({ chain: null }))).toEqual({
      ok: false,
      reason: 'unavailable',
    });
    expect(sent).toHaveLength(0);
  });

  it('refuses when the store is down', async () => {
    const broken: DripStore = {
      ...memoryDripStore(),
      hitIp: async () => {
        throw new Error('ECONNREFUSED');
      },
    };
    const { chain, sent } = fakeChain();
    expect(await runDrip(PLAYER, 'a', deps({ store: broken, chain }))).toEqual({
      ok: false,
      reason: 'unavailable',
    });
    expect(sent).toHaveLength(0);
  });

  it('says when the drip wallet is nearly empty, and lets the address try later', async () => {
    const store = memoryDripStore();
    const empty = fakeChain({ dripBalance: async () => parseEther('0.0005') });
    expect(await runDrip(PLAYER, 'a', deps({ store, chain: empty.chain }))).toEqual({
      ok: false,
      reason: 'drip-empty',
    });
    expect(empty.sent).toHaveLength(0);
    expect(store.days.get('2026-11-25')).toBe(0);
    expect((await runDrip(PLAYER, 'a', deps({ store }))).ok).toBe(true);
  });

  it('undoes its counting when the send fails', async () => {
    const store = memoryDripStore();
    const failing = fakeChain({
      send: async () => {
        throw new Error('nonce too low');
      },
    });
    const log = vi.fn();
    expect(await runDrip(PLAYER, 'a', deps({ store, chain: failing.chain, log }))).toEqual({
      ok: false,
      reason: 'unavailable',
    });
    expect(log).toHaveBeenCalledWith(expect.stringContaining('nonce too low'));
    expect(await store.lock()).toBe(true); // released
    await store.unlock();
    expect((await runDrip(PLAYER, 'a', deps({ store }))).ok).toBe(true);
  });

  it('waits for another drip in flight, then gives up as busy', async () => {
    const store = memoryDripStore();
    await store.lock();
    expect(await runDrip(PLAYER, 'a', deps({ store }))).toEqual({ ok: false, reason: 'busy' });
    await store.unlock();
    expect((await runDrip(PLAYER, 'a', deps({ store }))).ok).toBe(true);
  });
});

describe('parseDripBody', () => {
  it('accepts exactly { address }', () => {
    expect(parseDripBody({ address: PLAYER.toLowerCase() })).toBe(PLAYER);
  });

  it('rejects anything else', () => {
    expect(parseDripBody(null)).toBeNull();
    expect(parseDripBody('0x70997970C51812dc3A010C7d01b50e0d17dc79C8')).toBeNull();
    expect(parseDripBody({ address: '0x1234' })).toBeNull();
    expect(parseDripBody({ address: 42 })).toBeNull();
    expect(parseDripBody({ address: PLAYER, amount: '1' })).toBeNull();
    expect(parseDripBody([PLAYER])).toBeNull();
  });
});

describe('parseDripSettings', () => {
  it('reads amounts in ETH, with defaults for missing or bad values', () => {
    expect(parseDripSettings({})).toEqual(DEFAULT_DRIP);
    expect(
      parseDripSettings({
        DRIP_AMOUNT_ETH: '0.003',
        DRIP_MIN_BALANCE_ETH: '0.001',
        DRIP_DAILY_CAP_ETH: '0.5',
        DRIP_PER_IP_DAILY: '2',
      }),
    ).toEqual({
      amountWei: parseEther('0.003'),
      minBalanceWei: parseEther('0.001'),
      dailyCapWei: parseEther('0.5'),
      perIpDaily: 2,
    });
    expect(parseDripSettings({ DRIP_AMOUNT_ETH: 'lots', DRIP_PER_IP_DAILY: '-1' })).toEqual(
      DEFAULT_DRIP,
    );
  });
});

describe('dripStatusCode', () => {
  it('maps outcomes to HTTP statuses', () => {
    expect(dripStatusCode({ ok: true, hash: HASH, amountWei: 1n })).toBe(200);
    expect(dripStatusCode({ ok: false, reason: 'bad-request' })).toBe(400);
    expect(dripStatusCode({ ok: false, reason: 'not-testnet' })).toBe(403);
    expect(dripStatusCode({ ok: false, reason: 'daily-cap' })).toBe(429);
    expect(dripStatusCode({ ok: false, reason: 'unavailable' })).toBe(503);
  });
});

describe('dripStatus', () => {
  const base = { settings: DEFAULT_DRIP, configTestnet: true, dripAddress: OTHER };

  it('reports the drip wallet and whether it can send', async () => {
    const status = await dripStatus({
      ...base,
      store: memoryDripStore(),
      chain: fakeChain().chain,
    });
    expect(status).toMatchObject({
      available: true,
      dripAddress: OTHER,
      dripBalanceWei: parseEther('1').toString(),
      amountWei: parseEther('0.0005').toString(),
    });
  });

  it('is unavailable without a store, on a mainnet, or when empty', async () => {
    const chain = fakeChain().chain;
    expect((await dripStatus({ ...base, store: null, chain })).available).toBe(false);
    expect(
      (await dripStatus({ ...base, configTestnet: false, store: memoryDripStore(), chain }))
        .available,
    ).toBe(false);
    const empty = fakeChain({ dripBalance: async () => 0n }).chain;
    expect((await dripStatus({ ...base, store: memoryDripStore(), chain: empty })).available).toBe(
      false,
    );
  });
});
