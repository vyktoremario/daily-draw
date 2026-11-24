import { writeFileSync } from 'node:fs';
import { settlementVectors } from '../src/vectors.js';

const path = new URL('../test-vectors/settlement.json', import.meta.url);
writeFileSync(path, JSON.stringify(settlementVectors(), null, 2) + '\n');
console.log('wrote', path.pathname);
