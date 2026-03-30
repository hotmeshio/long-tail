import { defineConfig } from 'vitest/config';
import { config } from 'dotenv';
config();

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    globalSetup: ['tests/setup/global.ts'],
    setupFiles: ['tests/setup/clear-roles.ts'],
    include: ['tests/integration/**/*.test.ts'],
    exclude: ['node_modules', 'build'],
    testTimeout: 120_000,
    hookTimeout: 120_000,
    fileParallelism: false,
    pool: 'forks',
    env: {
      NODE_ENV: 'test',
      POSTGRES_DB: 'longtail_test',
      HMSH_SCOUT_INTERVAL_SECONDS: '5',
      HMSH_ROUTER_SCOUT_INTERVAL_SECONDS: '5',
    },
  },
});
