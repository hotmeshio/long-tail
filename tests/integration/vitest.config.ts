import { defineConfig } from 'vitest/config';
import { config } from 'dotenv';

// Load .env so LLM API keys are available.
config();

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/integration/**/*.test.ts'],
    globalSetup: ['tests/integration/global-setup.ts'],
    testTimeout: 600_000,   // 10 minutes — LLM workflows take 3-5 min
    hookTimeout: 300_000,   // 5 minutes — Docker health wait
    fileParallelism: false,
    pool: 'forks',
  },
});
