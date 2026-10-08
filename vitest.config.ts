import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'packages',
          include: ['packages/*/test/**/*.test.ts', 'services/*/test/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'ui',
          include: ['packages/ui/test/**/*.test.{ts,tsx}', 'apps/*/test/**/*.test.{ts,tsx}', 'packages/client-sdk/test/**/*.test.tsx'],
          environment: 'jsdom',
        },
      },
      {
        test: {
          name: 'property',
          include: ['tests/property/**/*.test.ts'],
          environment: 'node',
          testTimeout: 120_000,
        },
      },
      {
        test: {
          name: 'integration',
          include: ['tests/integration/**/*.test.ts', 'tests/e2e/**/*.test.ts', 'tests/chaos/**/*.test.ts'],
          environment: 'node',
          testTimeout: 300_000,
          hookTimeout: 120_000,
        },
      },
    ],
  },
});
