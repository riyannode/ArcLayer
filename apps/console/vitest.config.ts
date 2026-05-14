import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    passWithNoTests: true,
  },
  resolve: {
    alias: {
      '@': new URL('./src', import.meta.url).pathname,
      '@arclayer/sdk': new URL('../../sdk/src/index.ts', import.meta.url).pathname,
      '@arclayer/indexer': new URL('../../indexer/src', import.meta.url).pathname,
    },
  },
});
