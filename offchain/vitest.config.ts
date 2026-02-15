import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/index.ts'],
    },
    // Supervision tree: tests should fail fast
    bail: 1,
    // Parallel execution for independent test suites
    pool: 'threads',
    poolOptions: {
      threads: {
        singleThread: false,
      },
    },
  },
});
