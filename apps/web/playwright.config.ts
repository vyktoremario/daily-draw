import { defineConfig, devices } from '@playwright/test';

/**
 * Smoke tests against the local chain. Needs Anvil with the contracts deployed (`pnpm dev:chain`,
 * which also writes apps/web/.env.local); starts the web app unless one is already on :3000.
 *   pnpm dev:chain && pnpm --filter @daily-draw/web test:e2e
 */
export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  use: {
    baseURL: 'http://localhost:3000',
    ...devices['Pixel 7'],
    viewport: { width: 360, height: 780 },
  },
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:3000',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
