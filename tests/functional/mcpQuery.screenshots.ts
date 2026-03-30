/**
 * mcpQuery screenshot companion — captures the compilation wizard at each panel.
 *
 * Mirrors the golden path in mcpQuery.test.ts:
 *   Submit query → Wait → Profile → Deploy → Test → Verify
 *
 * Three modes:
 *   - Static shots (01-02): always available, no LLM needed
 *   - Wizard from existing query (03-10): pass --query-url with a completed query
 *   - Wizard from new query (03-10): submits a fresh mcpQuery (LLM key needed)
 *
 * Usage (standalone):
 *   npx tsx tests/functional/mcpQuery.screenshots.ts --static-only
 *   npx tsx tests/functional/mcpQuery.screenshots.ts --query-url http://localhost:5173/mcp/queries/some-id
 *   npx tsx tests/functional/mcpQuery.screenshots.ts                  # submits new query (needs LLM key)
 *
 * Usage (as module):
 *   import { captureStaticShots, captureWizardShots } from './mcpQuery.screenshots';
 */
import * as path from 'path';
import { ScreenshotService, ScreenshotPage, DOCS_IMG_DIR, log } from './screenshot-service';

const COMP_DIR = path.join(DOCS_IMG_DIR, 'compilation');
const WORKFLOW_NAME = 'docs-screenshots';
const APP_ID = 'docsscreenshots';

const CANONICAL_PROMPT = [
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

// ── Static shots (no LLM required) ──────────────────────────────────────────

/** Capture the Discover & Compile page and Tool Servers page. */
export async function captureStaticShots(
  page: ScreenshotPage,
  svc: ScreenshotService,
): Promise<void> {
  // 01 — Discover & Compile page with prompt filled
  await svc.navigate(page, '/mcp/queries');
  const textarea = page.locator('textarea[placeholder*="Describe what you want"]');
  await textarea.fill(CANONICAL_PROMPT);
  await page.waitForTimeout(500);
  await svc.capture(page, '01-query-submit.png', 'compilation');

  // 02 — Tool Servers with expanded server
  await svc.navigate(page, '/mcp/servers');
  const firstServer = page.locator('tr.cursor-pointer').first();
  if (await firstServer.count()) {
    await firstServer.click();
    await page.waitForTimeout(500);
  }
  await svc.capture(page, '02-mcp-servers.png', 'compilation');
}

// ── Wizard shots ─────────────────────────────────────────────────────────────

/**
 * Walk the full compilation wizard and capture each panel.
 * If queryDetailUrl is provided, uses that existing query.
 * Otherwise, submits a new query (requires LLM key).
 */
export async function captureWizardShots(
  page: ScreenshotPage,
  svc: ScreenshotService,
  queryDetailUrl?: string,
): Promise<void> {
  await svc.cleanupWorkflowsByName(page, WORKFLOW_NAME);

  // If no existing query, submit a new one
  if (!queryDetailUrl) {
    await svc.navigate(page, '/mcp/queries');
    const textarea = page.locator('textarea[placeholder*="Describe what you want"]');
    await textarea.fill(CANONICAL_PROMPT);
    await page.locator('button:has-text("Run")').click();
    await page.waitForURL(/\/mcp\/queries\//, { timeout: 15_000 });
    queryDetailUrl = page.url();
    log('compilation', `Query submitted → ${queryDetailUrl}`);

    // Wait for completion
    log('compilation', 'Waiting for dynamic workflow completion (up to 9 min)...');
    await page.locator('text=completed').first().waitFor({ timeout: 540_000 });
    await page.waitForTimeout(1000);
  } else {
    // Navigate to the existing query
    await page.goto(queryDetailUrl);
    await page.waitForTimeout(2000);
  }

  // 03 — Query detail page
  await svc.capture(page, '03-query-completed.png', 'compilation');

  // 04 — Panel 1: Original
  await page.goto(svc.stepUrl(queryDetailUrl, 1));
  await page.waitForTimeout(2000);
  await svc.capture(page, '04-wizard-original.png', 'compilation');

  // 05 — Panel 2: Timeline
  await page.goto(svc.stepUrl(queryDetailUrl, 2));
  await page.waitForTimeout(2000);
  await svc.capture(page, '05-wizard-timeline.png', 'compilation');

  // 06 — Panel 3: Profile (fill form, screenshot before compile)
  await page.goto(svc.stepUrl(queryDetailUrl, 3));
  await page.waitForTimeout(2000);

  const profileHeading = page.locator('h2:has-text("Create Workflow Profile")');
  const isNewProfile = await profileHeading.isVisible().catch(() => false);

  if (isNewProfile) {
    const inputs = page.locator('input[type="text"]');
    if ((await inputs.count()) >= 2) {
      await inputs.nth(0).clear();
      await inputs.nth(0).fill(APP_ID);
      await inputs.nth(1).clear();
      await inputs.nth(1).fill(WORKFLOW_NAME);
    }
    await page.waitForTimeout(3_000);

    const descTextarea = page.locator('textarea').first();
    if (await descTextarea.isVisible()) {
      const value = await descTextarea.inputValue();
      if (!value.trim()) {
        await descTextarea.fill(
          'Logs into a web app, discovers navigation pages, and captures screenshots.',
        );
      }
    }
  }
  await svc.capture(page, '06-wizard-profile.png', 'compilation');

  // Compile (if not already compiled)
  if (isNewProfile) {
    const createBtn = page.locator('button:has-text("Create Profile")');
    await createBtn.waitFor({ state: 'visible', timeout: 5_000 });
    await createBtn.click();
    log('compilation', 'Compiling...');
    await page
      .locator('text=Deterministic Workflow Profile')
      .or(page.locator('text=Deploy Workflow'))
      .first()
      .waitFor({ timeout: 120_000 });
    log('compilation', 'Compilation complete');
  }

  // 07 — Panel 4: Deploy (YAML visible)
  await page.goto(svc.stepUrl(queryDetailUrl, 4));
  await page.waitForTimeout(2000);
  await svc.capture(page, '07-wizard-deploy.png', 'compilation');

  // Deploy (if not already active)
  const deployBtn = page.locator('button:has-text("Deploy")').first();
  const needsDeploy = await deployBtn.isVisible().catch(() => false);
  if (needsDeploy) {
    await deployBtn.click();
    log('compilation', 'Deploying...');
    await page.locator('text=active').first().waitFor({ timeout: 30_000 });
    log('compilation', 'Deployed and active');
  }

  // Extract workflow ID for cleanup
  let yamlWorkflowId = '';
  const editLink = page
    .locator('a:has-text("Edit Workflow"), a[href*="/mcp/workflows/"]')
    .first();
  if (await editLink.isVisible()) {
    const href = (await editLink.getAttribute('href')) || '';
    yamlWorkflowId = href.split('/').pop() || '';
  }

  // 08 — Panel 5: Test modal mid-execution
  await page.goto(svc.stepUrl(queryDetailUrl, 5));
  await page.waitForTimeout(2000);

  const runTestBtn = page.locator('button:has-text("Run Test")');
  await runTestBtn.waitFor({ state: 'visible', timeout: 10_000 });
  await runTestBtn.click();
  await page.waitForTimeout(2_000);
  await page.locator('button:has-text("Invoke")').click();
  await page.waitForTimeout(3_000);
  await svc.capture(page, '08-wizard-test-modal.png', 'compilation');

  // 09 — Panel 5: Side-by-side comparison after completion
  log('compilation', 'Waiting for deterministic run to complete...');
  await page.locator('text=completed').first().waitFor({ timeout: 300_000 });
  await page.waitForTimeout(2000);
  await svc.capture(page, '09-wizard-test-compare.png', 'compilation');

  // 10 — Panel 6: Verify through router
  await page.goto(svc.stepUrl(queryDetailUrl, 6));
  await page.waitForTimeout(2000);

  const submitBtn = page.locator('button:has-text("Submit")');
  await submitBtn.waitFor({ state: 'visible', timeout: 10_000 });
  await submitBtn.click();
  log('compilation', 'Submitted verification, waiting for router result...');
  try {
    await page.locator('text=Deterministic').first().waitFor({ timeout: 300_000 });
  } catch {
    log('compilation', 'Deterministic badge not found — capturing current state');
  }
  await page.waitForTimeout(1000);
  await svc.capture(page, '10-wizard-verify.png', 'compilation');

  // Cleanup only if we created the workflow
  if (isNewProfile && yamlWorkflowId) {
    await svc.deleteWorkflow(page, yamlWorkflowId);
  }
}

// ── Standalone runner ────────────────────────────────────────────────────────

function getArg(name: string): string | undefined {
  const idx = process.argv.indexOf(name);
  return idx >= 0 && idx + 1 < process.argv.length ? process.argv[idx + 1] : undefined;
}

async function main() {
  const { chromium } = await import('playwright');

  const queryUrl = getArg('--query-url');
  const baseUrl = queryUrl ? new URL(queryUrl).origin : undefined;

  const svc = new ScreenshotService({ outputDir: COMP_DIR, baseUrl });
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  await svc.login(page);
  log('login', 'Logged in as superadmin');

  await captureStaticShots(page, svc);

  const staticOnly = process.argv.includes('--static-only');
  const hasLLMKey = !!(process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY);

  if (staticOnly) {
    log('compilation', 'Skipped wizard (--static-only)');
  } else if (queryUrl) {
    log('compilation', `Using existing query: ${queryUrl}`);
    await captureWizardShots(page, svc, queryUrl);
  } else if (!hasLLMKey) {
    log('compilation', 'Skipped wizard (no LLM key — use --query-url for existing query)');
  } else {
    await captureWizardShots(page, svc);
  }

  await browser.close();
  console.log(`Done — screenshots saved to ${COMP_DIR}`);
}

// Run standalone if executed directly
if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
