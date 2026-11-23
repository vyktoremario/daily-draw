/**
 * Draw fairness protocol (design: "Draw and fairness protocol").
 *
 * 1. Before sales open the operator commits to a 32-byte secret seed S:
 *      commitment = SHA-256("DD-v1" ‖ drawId ‖ S)
 * 2. At the cutoff, tickets are hashed into a Merkle tree; the root M is anchored on-chain.
 * 3. The drand round named in advance supplies a 32-byte public random value R.
 * 4. winning = uint256(SHA-256(S ‖ R ‖ M)) mod range
 *
 * Merkle tree: leaf = SHA-256(0x00 ‖ ticket encoding), node = SHA-256(0x01 ‖ left ‖ right).
 * The 0x00/0x01 prefixes stop a leaf being passed off as an inner node. An odd node at the
 * end of a level is carried up unchanged. Leaves are ordered by ticket ID.
 *
 * Everything here is pure and works the same in Node and the browser, so the public
 * "Verify this draw" page runs exactly this code.
 */
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, concatBytes, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';

export const PROTOCOL_TAG = 'DD-v1';
const LEAF_PREFIX = new Uint8Array([0x00]);
const NODE_PREFIX = new Uint8Array([0x01]);

export type Hex = string;

export interface TicketLeaf {
  ticketId: string;
  drawId: string;
  /** The picked number, e.g. 7 for "07". */
  number: number;
  /** ISO 8601 UTC timestamp of purchase. */
  purchasedAt: string;
}

export interface ProofStep {
  sibling: Hex;
  /** Which side the sibling sits on when hashing up the tree. */
  position: 'left' | 'right';
}

function toBytes32(hex: Hex, name: string): Uint8Array {
  const bytes = hexToBytes(hex.startsWith('0x') ? hex.slice(2) : hex);
  if (bytes.length !== 32) throw new Error(`${name} must be 32 bytes, got ${bytes.length}`);
  return bytes;
}

/** Commitment published before sales open. */
export function commitment(drawId: string, seedHex: Hex): Hex {
  const seed = toBytes32(seedHex, 'seed');
  return bytesToHex(sha256(concatBytes(utf8ToBytes(PROTOCOL_TAG), utf8ToBytes(drawId), seed)));
}

/** Check a revealed seed against its earlier commitment. */
export function verifyCommitment(drawId: string, seedHex: Hex, commitmentHex: Hex): boolean {
  return commitment(drawId, seedHex) === commitmentHex.toLowerCase().replace(/^0x/, '');
}

export function encodeTicket(t: TicketLeaf): string {
  if (t.ticketId.includes('|') || t.drawId.includes('|')) {
    throw new Error('Ticket and draw IDs must not contain "|"');
  }
  return `${t.ticketId}|${t.drawId}|${t.number}|${t.purchasedAt}`;
}

export function leafHash(t: TicketLeaf): Hex {
  return bytesToHex(sha256(concatBytes(LEAF_PREFIX, utf8ToBytes(encodeTicket(t)))));
}

function nodeHash(left: Uint8Array, right: Uint8Array): Uint8Array {
  return sha256(concatBytes(NODE_PREFIX, left, right));
}

/** Sort tickets into the canonical order used for the tree. */
export function sortTickets<T extends TicketLeaf>(tickets: readonly T[]): T[] {
  return [...tickets].sort((a, b) =>
    a.ticketId < b.ticketId ? -1 : a.ticketId > b.ticketId ? 1 : 0,
  );
}

function buildLevels(leaves: Uint8Array[]): Uint8Array[][] {
  const levels: Uint8Array[][] = [leaves];
  let level = leaves;
  while (level.length > 1) {
    const next: Uint8Array[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i]!;
      const right = level[i + 1];
      next.push(right ? nodeHash(left, right) : left);
    }
    levels.push(next);
    level = next;
  }
  return levels;
}

/** Merkle root of the tickets in canonical order. An empty draw has an all-zero root. */
export function merkleRoot(tickets: readonly TicketLeaf[]): Hex {
  if (tickets.length === 0) return '00'.repeat(32);
  const leaves = sortTickets(tickets).map((t) => hexToBytes(leafHash(t)));
  const levels = buildLevels(leaves);
  return bytesToHex(levels[levels.length - 1]![0]!);
}

/** Proof that one ticket is included in the root. */
export function merkleProof(tickets: readonly TicketLeaf[], ticketId: string): ProofStep[] {
  const sorted = sortTickets(tickets);
  let index = sorted.findIndex((t) => t.ticketId === ticketId);
  if (index < 0) throw new Error(`Ticket ${ticketId} is not in this draw`);
  const levels = buildLevels(sorted.map((t) => hexToBytes(leafHash(t))));
  const proof: ProofStep[] = [];
  for (let depth = 0; depth < levels.length - 1; depth++) {
    const level = levels[depth]!;
    const isRight = index % 2 === 1;
    const siblingIndex = isRight ? index - 1 : index + 1;
    const sibling = level[siblingIndex];
    if (sibling) proof.push({ sibling: bytesToHex(sibling), position: isRight ? 'left' : 'right' });
    index = Math.floor(index / 2);
  }
  return proof;
}

export function verifyMerkleProof(
  ticket: TicketLeaf,
  proof: readonly ProofStep[],
  rootHex: Hex,
): boolean {
  let hash: Uint8Array = hexToBytes(leafHash(ticket));
  for (const step of proof) {
    const sibling = toBytes32(step.sibling, 'proof sibling');
    hash = step.position === 'left' ? nodeHash(sibling, hash) : nodeHash(hash, sibling);
  }
  return bytesToHex(hash) === rootHex.toLowerCase().replace(/^0x/, '');
}

/** The winning number for a draw. range is 100 (00–99) or 1000 (000–999). */
export function winningNumber(
  seedHex: Hex,
  drandRandomnessHex: Hex,
  merkleRootHex: Hex,
  range: number,
): number {
  if (!Number.isInteger(range) || range < 2) throw new Error(`Invalid range ${range}`);
  const digest = sha256(
    concatBytes(
      toBytes32(seedHex, 'seed'),
      toBytes32(drandRandomnessHex, 'drand randomness'),
      toBytes32(merkleRootHex, 'merkle root'),
    ),
  );
  return Number(BigInt(`0x${bytesToHex(digest)}`) % BigInt(range));
}

export interface DrawRecord {
  drawId: string;
  range: number;
  commitment: Hex;
  revealedSeed: Hex;
  drandRandomness: Hex;
  merkleRoot: Hex;
  winningNumber: number;
}

export interface VerificationResult {
  commitmentMatches: boolean;
  winningNumberMatches: boolean;
  recomputedWinningNumber: number;
  ok: boolean;
}

/**
 * Checks a published draw record. Checking the drand signature and the on-chain anchor
 * happens outside this function (they need network access).
 */
export function verifyDraw(record: DrawRecord): VerificationResult {
  const commitmentMatches = verifyCommitment(record.drawId, record.revealedSeed, record.commitment);
  const recomputedWinningNumber = winningNumber(
    record.revealedSeed,
    record.drandRandomness,
    record.merkleRoot,
    record.range,
  );
  const winningNumberMatches = recomputedWinningNumber === record.winningNumber;
  return {
    commitmentMatches,
    winningNumberMatches,
    recomputedWinningNumber,
    ok: commitmentMatches && winningNumberMatches,
  };
}
