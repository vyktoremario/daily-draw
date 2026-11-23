import { describe, expect, it } from 'vitest';
import {
  commitment,
  merkleProof,
  merkleRoot,
  verifyCommitment,
  verifyDraw,
  verifyMerkleProof,
  winningNumber,
  type TicketLeaf,
} from './fairness.js';

const SEED = '11'.repeat(32);
const DRAND = '22'.repeat(32);

function tickets(n: number): TicketLeaf[] {
  return Array.from({ length: n }, (_, i) => ({
    ticketId: `DD-${String(i).padStart(5, '0')}`,
    drawId: 'draw-313',
    number: (i * 37) % 100,
    purchasedAt: new Date(Date.UTC(2026, 10, 23, 18, 0, i)).toISOString(),
  }));
}

describe('commitment', () => {
  it('is deterministic and binds the draw ID', () => {
    expect(commitment('draw-313', SEED)).toBe(commitment('draw-313', SEED));
    expect(commitment('draw-313', SEED)).not.toBe(commitment('draw-314', SEED));
    expect(verifyCommitment('draw-313', SEED, commitment('draw-313', SEED))).toBe(true);
    expect(verifyCommitment('draw-313', '12'.repeat(32), commitment('draw-313', SEED))).toBe(false);
  });

  it('rejects seeds that are not 32 bytes', () => {
    expect(() => commitment('draw-313', 'abcd')).toThrow();
  });
});

describe('merkle tree', () => {
  it('does not depend on input order', () => {
    const t = tickets(10);
    expect(merkleRoot(t)).toBe(merkleRoot([...t].reverse()));
  });

  it('proves inclusion for every ticket, including odd-sized trees', () => {
    for (const n of [1, 2, 3, 7, 16, 33]) {
      const t = tickets(n);
      const root = merkleRoot(t);
      for (const ticket of t) {
        expect(verifyMerkleProof(ticket, merkleProof(t, ticket.ticketId), root)).toBe(true);
      }
    }
  });

  it('fails when a ticket is altered or added', () => {
    const t = tickets(9);
    const root = merkleRoot(t);
    const target = t[4]!;
    const proof = merkleProof(t, target.ticketId);
    expect(verifyMerkleProof({ ...target, number: (target.number + 1) % 100 }, proof, root)).toBe(
      false,
    );
    expect(merkleRoot([...t, ...tickets(10).slice(9)])).not.toBe(root);
  });
});

describe('winningNumber', () => {
  it('stays in range and changes with every input', () => {
    const root = merkleRoot(tickets(20));
    const n = winningNumber(SEED, DRAND, root, 100);
    expect(n).toBeGreaterThanOrEqual(0);
    expect(n).toBeLessThan(100);
    const others = [
      winningNumber('33'.repeat(32), DRAND, root, 1000),
      winningNumber(SEED, '44'.repeat(32), root, 1000),
      winningNumber(SEED, DRAND, merkleRoot(tickets(21)), 1000),
    ];
    expect(new Set([winningNumber(SEED, DRAND, root, 1000), ...others]).size).toBe(4);
  });

  it('is close to uniform', () => {
    const counts = new Array<number>(10).fill(0);
    for (let i = 0; i < 5_000; i++) {
      const seed = i.toString(16).padStart(64, '0');
      counts[winningNumber(seed, DRAND, SEED, 10)]!++;
    }
    for (const c of counts) expect(Math.abs(c - 500)).toBeLessThan(100);
  });
});

describe('verifyDraw', () => {
  it('passes an honest draw and fails a tampered one', () => {
    const root = merkleRoot(tickets(50));
    const record = {
      drawId: 'draw-313',
      range: 100,
      commitment: commitment('draw-313', SEED),
      revealedSeed: SEED,
      drandRandomness: DRAND,
      merkleRoot: root,
      winningNumber: winningNumber(SEED, DRAND, root, 100),
    };
    expect(verifyDraw(record).ok).toBe(true);
    expect(verifyDraw({ ...record, winningNumber: (record.winningNumber + 1) % 100 }).ok).toBe(
      false,
    );
    expect(verifyDraw({ ...record, revealedSeed: '55'.repeat(32) }).commitmentMatches).toBe(false);
  });
});
