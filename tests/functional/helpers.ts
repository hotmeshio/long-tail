/**
 * Playwright functional test helpers — login, selectors, and utilities.
 */

import { type Page, expect } from '@playwright/test';

// ── Logging ──────────────────────────────────────────────────────────────────

export function log(phase: string, message: string): void {
  const ts = new Date().toISOString().slice(11, 23);
  console.log(`  [${ts}] [${phase}] ${message}`);
}

// ── Authentication ───────────────────────────────────────────────────────────

/**
 * Login via the dashboard UI. Retries until seed users are available.
 * After login, waits for the 1500ms comet animation + redirect.
 */
export async function login(
  page: Page,
  username: string,
  password: string,
): Promise<void> {
  const deadline = Date.now() + 90_000;

  while (Date.now() < deadline) {
    try {
      await page.goto('/login', { timeout: 10_000 });
    } catch {
      // Server not ready yet — wait and retry
      log('login', `Server not ready, retrying in 3s...`);
      await page.waitForTimeout(3_000);
      continue;
    }

    await page.locator('#username').fill(username);
    await page.locator('#password').fill(password);
    await page.locator('button:has-text("Sign In")').click();

    // Check if login succeeded (navigated away from /login)
    try {
      await page.waitForURL((url) => !url.pathname.includes('/login'), {
        timeout: 5_000,
      });
      return;
    } catch {
      // Seed data may not be ready — retry
      const errorText = await page.locator('.text-status-error').textContent().catch(() => '');
      if (errorText?.includes('Invalid credentials')) {
        log('login', `Retrying login for ${username} (seed not ready)...`);
        await page.waitForTimeout(2_000);
        continue;
      }
      // Other error (e.g., unable to connect) — retry
      log('login', `Login attempt failed: ${errorText || 'unknown'}, retrying...`);
      await page.waitForTimeout(2_000);
    }
  }

  throw new Error(`Login timed out for ${username} after 90s`);
}

// ── Navigation helpers ───────────────────────────────────────────────────────

/** Navigate to the Deterministic MCP page via sidebar. */
export async function goToMcpQueries(page: Page): Promise<void> {
  await page.goto('/mcp/queries');
  await expect(page.locator('text=Deterministic MCP')).toBeVisible();
}

/** Navigate to available escalations. */
export async function goToAvailableEscalations(page: Page): Promise<void> {
  await page.goto('/escalations/available');
  // Wait for table to render
  await page.waitForTimeout(2_000);
}

// ── Wait helpers (NATS-driven) ───────────────────────────────────────────────

/**
 * Wait for a text to appear on the page, leveraging NATS-driven UI updates.
 * The dashboard auto-refreshes when workflow events arrive via WebSocket NATS.
 */
export async function waitForText(
  page: Page,
  text: string,
  timeoutMs = 300_000,
): Promise<void> {
  await expect(page.locator(`text=${text}`).first()).toBeVisible({ timeout: timeoutMs });
}

/**
 * Wait for workflow completion on the query detail page.
 * The dashboard polls and NATS-updates status automatically.
 */
export async function waitForQueryCompletion(
  page: Page,
  timeoutMs = 540_000,
): Promise<void> {
  // The status badge updates via NATS — wait for "completed" to appear
  await expect(
    page.locator('text=completed').first(),
  ).toBeVisible({ timeout: timeoutMs });
}

// ── Constants ────────────────────────────────────────────────────────────────

export const CANONICAL_PROMPT = [
  'Navigate to http://localhost:3000/.',
  'When prompted, login with name/pass: superadmin/l0ngt@1l.',
  'Once you are logged in, you will be redirected to the site root /.',
  'Locate all top-level page links that are located in the left side navigation list.',
  'Loop through each and save a screenshot image of each linked page,',
  'waiting for it to fully load before taking the screenshot.',
  'Save to images using a deterministic name based upon the link',
  '(e.g long-tail-screenshots/home.png).',
  'For the root page (home page) just use home.png',
].join(' ');

export const PASSWORD = 'l0ngt@1l';

export const WORKFLOW_NAME = 'functional-test-screenshots';
export const APP_ID = 'integrationtest';
