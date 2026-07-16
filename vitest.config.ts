import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // The market-route integration test exercises the live NSE provider, which
    // primes the Akamai cookie jar (homepage + quote page) before the API call.
    // Each priming GET is bounded (see session.ts WARM_TIMEOUT_MS), so the whole
    // sequence stays well under this ceiling even when NSE tar-pits the HTML pages.
    testTimeout: 20000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/**/*.d.ts'],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
});
