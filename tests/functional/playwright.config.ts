import { defineConfig, devices } from '@playwright/test';
import { config } from 'dotenv';
import { tmpdir } from 'os';
import { join } from 'path';

config();

// Artifacts go to OS temp dir — never checked in, auto-cleaned by OS.
// Set PW_OUTPUT_DIR to override (e.g. for CI artifact collection).
const outputDir = process.env.PW_OUTPUT_DIR || join(tmpdir(), 'lt-playwright');

export default defineConfig({
  testDir: '.',
  outputDir,
  timeout: 600_000,           // 10 min per test — LLM workflows take 3-5 min
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'off',
    screenshot: 'off',
    video: 'off',
    actionTimeout: 15_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
