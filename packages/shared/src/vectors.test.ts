import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { settlementVectors } from './vectors.js';

describe('settlement test vectors', () => {
  it('match the committed file (run `pnpm --filter @daily-draw/shared vectors` to update)', () => {
    const committed = JSON.parse(
      readFileSync(new URL('../test-vectors/settlement.json', import.meta.url), 'utf8'),
    );
    expect(committed).toEqual(JSON.parse(JSON.stringify(settlementVectors())));
  });
});
