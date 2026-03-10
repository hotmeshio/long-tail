import { defineConfig } from 'vitest/config';
import { config } from 'dotenv';

// Load .env so API keys (OPENAI_API_KEY, etc.) are available via fork inheritance.
config();

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    globalSetup: ['tests/setup/global.ts'],
    setupFiles: ['tests/setup/clear-roles.ts'],
    include: ['tests/**/*.test.ts'],
    exclude: ['node_modules', 'build'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    fileParallelism: false,
    pool: 'forks',
    env: {
      NODE_ENV: 'test',
      // ALWAYS use the test database — hardcoded to prevent .env or shell
      // env from accidentally routing tests to the dev database.
      POSTGRES_DB: 'longtail_test',
      // HotMesh scout role TTL + loser retry interval.
      // Default is 60s. We set 5s as a safety net in case role cleanup
      // fails (e.g., crash). The primary fix is clearing stale roles
      // in globalSetup before tests run.
      HMSH_SCOUT_INTERVAL_SECONDS: '5',
      HMSH_ROUTER_SCOUT_INTERVAL_SECONDS: '5',
    },
  },
});
