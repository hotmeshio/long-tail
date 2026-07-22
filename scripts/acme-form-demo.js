/* Drives the perfect-form showcase: opens the pending acme escalation, claims
 * it, and captures the linear reveal — Choose… → Complete (checklists) and
 * Choose… → Reject (the report fading in with the choice).
 * Run inside the container: node scripts/acme-form-demo.js
 */
const { chromium } = require('playwright');

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const OUT = '/app/.smoke';

async function main() {
  require('fs').mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1366, height: 1200 } });

  await page.goto(`${BASE}/login`);
  await page.fill('input[type="text"], input[name="username"], input#username', 'superadmin');
  await page.fill('input[type="password"]', 'l0ngt@1l');
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.includes('login'), { timeout: 15000 });

  // The pending addons escalation from the seeded acmeWidget run.
  await page.goto(`${BASE}/escalations/available?role=acme-addons`);
  await page.waitForTimeout(1500);
  const row = page.locator('table tbody tr').first();
  await row.click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/acme-1-unclaimed.png` });

  // Claim (30 min default).
  const claimBtn = page.getByRole('button', { name: /^Claim$/ }).first();
  if (await claimBtn.count()) {
    await claimBtn.click();
    await page.waitForTimeout(1500);
  }
  await page.screenshot({ path: `${OUT}/acme-2-choose.png` });

  // Choose Complete — the ritual + custom work reveal.
  const outcome = page.locator('select[data-field-key="outcome"]');
  await outcome.selectOption('Complete');
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${OUT}/acme-3-complete-reveal.png`, fullPage: true });

  // Switch to Reject — the report fades in tied to the choice.
  await outcome.selectOption('Reject');
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/acme-4-reject-reveal.png`, fullPage: true });

  // Back to Complete, click the custom work, submit — stage 1 resolves and
  // the workflow mints the Final QA escalation.
  await outcome.selectOption('Complete');
  await page.waitForTimeout(400);
  await page.locator('input[type="checkbox"][data-item-id], [data-field-key="customChecks"] input[type="checkbox"]').first().waitFor({ timeout: 3000 }).catch(() => {});
  const customBoxes = page.locator('div:has(> p:text("Custom work")) input[type="checkbox"], input[type="checkbox"]');
  // Click every unchecked checklist box (the custom items; fixed arrived checked).
  const count = await customBoxes.count();
  for (let i = 0; i < count; i++) {
    const box = customBoxes.nth(i);
    if (!(await box.isChecked().catch(() => true))) await box.check().catch(() => {});
  }
  await page.getByRole('button', { name: /^Submit$/ }).click();
  await page.waitForTimeout(2500);

  // The QA stage: claim and capture the 2×2 reject reveal.
  await page.goto(`${BASE}/escalations/available?role=acme-final-qa`);
  await page.waitForTimeout(1500);
  await page.locator('table tbody tr').first().click();
  await page.waitForTimeout(1500);
  const qaClaim = page.getByRole('button', { name: /^Claim$/ }).first();
  if (await qaClaim.count()) {
    await qaClaim.click();
    await page.waitForTimeout(1500);
  }
  await page.screenshot({ path: `${OUT}/acme-5-qa-choose.png` });
  await page.locator('select[data-field-key="outcome"]').selectOption('Reject');
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/acme-6-qa-reject.png`, fullPage: true });

  await browser.close();
  console.log('acme form captures written to', OUT);
}

main().catch((err) => { console.error(err); process.exit(1); });
