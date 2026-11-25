import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['lib/**/*.test.ts'],
    // Lagos time is fixed (UTC+1, no DST), but keep the runner's own zone out of the results.
    env: { TZ: 'UTC' },
  },
});
