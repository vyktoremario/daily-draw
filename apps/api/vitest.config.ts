import { existsSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

// Load the repo's .env for local runs; CI sets DATABASE_URL itself.
const envFile = new URL('../../.env', import.meta.url);
if (existsSync(envFile)) process.loadEnvFile(envFile);

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    hookTimeout: 60_000,
    testTimeout: 30_000,
  },
});
