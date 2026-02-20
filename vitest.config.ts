import { defineConfig } from 'vitest/config';
import { config } from 'dotenv';

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
      ...(process.env.OPENAI_API_KEY ? { OPENAI_API_KEY: process.env.OPENAI_API_KEY } : {}),
    },
  },
});
