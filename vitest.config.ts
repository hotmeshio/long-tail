import { defineConfig } from 'vitest/config';
import { config } from 'dotenv';

// Load .env so API keys (OPENAI_API_KEY, etc.) are available via fork inheritance.
config();

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    exclude: ['node_modules', 'build'],
    testTimeout: 60_000,
    hookTimeout: 120_000,
    fileParallelism: false,
    pool: 'forks',
    env: {
      NODE_ENV: 'test',
      // ALWAYS use the test database — hardcoded to prevent .env or shell
      // env from accidentally routing tests to the dev database.
      POSTGRES_DB: 'longtail_test',
    },
  },
});
