/**
 * mcpQuery functional test — full lifecycle through the dashboard UI:
 *
 *   Login → Submit query → Wait for completion → Compile wizard →
 *   Deploy → Test deterministic → Verify through router
 *
 * Exercises the golden path that converts a dynamic LLM-orchestrated
 * workflow into a deterministic compiled DAG — entirely via browser.
 * NATS-driven real-time updates keep the UI current without polling.
 *
 * Prerequisites:
 *   - Docker running (docker compose up -d --build)
 *   - LLM API key set (ANTHROPIC_API_KEY or OPENAI_API_KEY)
 */

import { test, expect } from '@playwright/test';

import {
  login, log, goToMcpQueries, waitForQueryCompletion,
  CANONICAL_PROMPT, PASSWORD, WORKFLOW_NAME, APP_ID,
} from './helpers';

const hasLLMKey = !!(process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY);

test.describe.serial('mcpQuery UI lifecycle', () => {
  test.skip(!hasLLMKey, 'Requires LLM API key');

  // Shared state across sequential steps
  let queryDetailUrl: string;
  let yamlWorkflowUrl: string;

  test('login and submit dynamic mcpQuery', async ({ page }) => {
    await login(page, 'superadmin', PASSWORD);
    log('login', 'Logged in as superadmin');

    // Navigate to Deterministic MCP page
    await goToMcpQueries(page);
    log('navigate', 'On Deterministic MCP page');

    // Submit the canonical prompt
    const textarea = page.locator('textarea[placeholder*="Describe what you want"]');
    await textarea.fill(CANONICAL_PROMPT);
    await page.locator('button:has-text("Run")').click();

    // Wait for navigation to the query detail page
    await page.waitForURL(/\/mcp\/queries\//, { timeout: 15_000 });
    queryDetailUrl = page.url();
    log('submit', `Navigated to: ${queryDetailUrl}`);

    // Verify we're on the query detail page
    await expect(page.locator('text=Original MCP Query')).toBeVisible();
  });

  test('wait for dynamic workflow completion', async ({ page }) => {
    test.skip(!queryDetailUrl, 'No query detail URL from prior step');

    await login(page, 'superadmin', PASSWORD);
    await page.goto(queryDetailUrl);
    log('dynamic', 'Waiting for workflow completion (NATS-driven)...');

    const startTime = Date.now();

    // Dashboard auto-refreshes via NATS — wait for "completed" badge
    await waitForQueryCompletion(page, 540_000);

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    log('dynamic', `Workflow completed in ${elapsed}s`);

    // Workflow is done — the wizard may auto-advance to a later step
    log('dynamic', 'Workflow complete, ready for compile wizard');
  });

  test('fill profile and compile workflow', async ({ page }) => {
    test.skip(!queryDetailUrl, 'No query detail URL from prior step');

    await login(page, 'superadmin', PASSWORD);

    // Navigate directly to step 3 (Profile) via URL param
    const profileUrl = queryDetailUrl.includes('?')
      ? `${queryDetailUrl}&step=3`
      : `${queryDetailUrl}?step=3`;
    await page.goto(profileUrl);
    await page.waitForTimeout(2_000);

    log('compile', 'Navigated to Profile step');

    // Wait for the profile form — "Create Workflow Profile" heading
    await expect(
      page.locator('h2:has-text("Create Workflow Profile")'),
    ).toBeVisible({ timeout: 15_000 });

    // Fill namespace input (first text input in the Namespace section)
    const inputs = page.locator('input[type="text"]');
    const inputCount = await inputs.count();
    log('compile', `Found ${inputCount} text inputs`);

    // Namespace is the first input, Tool Name is the second
    if (inputCount >= 2) {
      await inputs.nth(0).clear();
      await inputs.nth(0).fill(APP_ID);
      await inputs.nth(1).clear();
      await inputs.nth(1).fill(WORKFLOW_NAME);
    }

    // Wait briefly for AI description to populate
    await page.waitForTimeout(3_000);

    // Fill description if empty
    const descTextarea = page.locator('textarea').first();
    if (await descTextarea.isVisible()) {
      const value = await descTextarea.inputValue();
      if (!value.trim()) {
        await descTextarea.fill('Logs into a web app, discovers navigation pages, and captures screenshots.');
      }
    }

    // Click Create Profile
    const createBtn = page.locator('button:has-text("Create Profile")');
    await expect(createBtn).toBeEnabled({ timeout: 5_000 });
    await createBtn.click();

    log('compile', 'Creating profile (compiling)...');

    // Wait for compilation to complete — page will show the existing profile view
    // or auto-advance to Deploy step
    await expect(
      page.locator('text=Deterministic Workflow Profile').or(page.locator('text=Deploy Workflow')),
    ).toBeVisible({ timeout: 60_000 });

    log('compile', 'Compilation complete');
  });

  test('deploy the compiled workflow', async ({ page }) => {
    test.skip(!queryDetailUrl, 'No query detail URL from prior step');

    await login(page, 'superadmin', PASSWORD);

    // Navigate to Deploy step via URL param
    const deployUrl = queryDetailUrl.includes('?')
      ? `${queryDetailUrl}&step=4`
      : `${queryDetailUrl}?step=4`;
    await page.goto(deployUrl);
    await page.waitForTimeout(2_000);

    // Click Deploy button (in the lifecycle sidebar)
    const deployBtn = page.locator('button:has-text("Deploy")').first();
    await expect(deployBtn).toBeVisible({ timeout: 10_000 });
    await deployBtn.click();

    log('deploy', 'Deploying...');

    // Wait for status to change to "active"
    await expect(page.locator('text=active')).toBeVisible({ timeout: 30_000 });
    log('deploy', 'Deployed and active');

    // Store the workflow detail URL for later cleanup
    const editLink = page.locator('a:has-text("Edit Workflow"), a[href*="/mcp/workflows/"]').first();
    if (await editLink.isVisible()) {
      yamlWorkflowUrl = await editLink.getAttribute('href') || '';
    }
  });

  test('test the deterministic workflow', async ({ page }) => {
    test.skip(!queryDetailUrl, 'No query detail URL from prior step');

    await login(page, 'superadmin', PASSWORD);

    // Navigate to Test step via URL param
    const testUrl = queryDetailUrl.includes('?')
      ? `${queryDetailUrl}&step=5`
      : `${queryDetailUrl}?step=5`;
    await page.goto(testUrl);
    await page.waitForTimeout(2_000);
    await expect(page.locator('text=Compare Runs')).toBeVisible({ timeout: 10_000 });

    log('test', 'On Test panel — invoking deterministic run');

    // Click "Run test" to open invoke modal
    await page.locator('button:has-text("Run test")').click();

    // Wait for modal to appear
    await expect(page.locator('text=Test Deterministic')).toBeVisible({ timeout: 5_000 });

    // Click Invoke button in the modal
    await page.locator('button:has-text("Invoke")').click();

    log('test', 'Invoked deterministic workflow, waiting for result...');

    // Wait for result to appear — NATS updates the UI
    // The modal closes or shows result; the Test panel shows the output
    await expect(page.locator('text=completed').first()).toBeVisible({ timeout: 300_000 });

    log('test', 'Deterministic run completed');
  });

  test('verify through mcpQueryRouter', async ({ page }) => {
    test.skip(!queryDetailUrl, 'No query detail URL from prior step');

    await login(page, 'superadmin', PASSWORD);

    // Navigate to Verify step via URL param
    const verifyUrl = queryDetailUrl.includes('?')
      ? `${queryDetailUrl}&step=6`
      : `${queryDetailUrl}?step=6`;
    await page.goto(verifyUrl);
    await page.waitForTimeout(2_000);
    await expect(page.getByRole('heading', { name: 'End-to-End Verification' })).toBeVisible({ timeout: 10_000 });

    log('verify', 'On Verify panel — submitting through router');

    // Original prompt should be pre-filled
    const textarea = page.locator('textarea[placeholder*="Type a natural language query"]');
    await expect(textarea).toBeVisible();

    // Click Submit
    await page.locator('button:has-text("Submit")').click();

    log('verify', 'Submitted, waiting for router result (NATS-driven)...');

    // Wait for "Deterministic" badge (indicates compiled workflow was used)
    await expect(
      page.locator('text=Deterministic').first(),
    ).toBeVisible({ timeout: 300_000 });

    log('verify', 'Router used compiled workflow — Deterministic badge visible');

  });
});
