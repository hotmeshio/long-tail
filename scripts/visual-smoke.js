/* Visual smoke test for the design-system foundation: logs in, captures the
 * escalations list and an escalation detail form in the default theme and in
 * the registered Midnight theme, at desktop and iPad widths.
 * Run inside the container: node scripts/visual-smoke.js
 */
const { chromium } = require('playwright');

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const OUT = '/app/.smoke';

async function main() {
  const fs = require('fs');
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });

  // Login
  await page.goto(`${BASE}/login`);
  await page.fill('input[type="text"], input[name="username"], input#username', 'superadmin');
  await page.fill('input[type="password"]', 'l0ngt@1l');
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.includes('login'), { timeout: 15000 });

  const PAGES = [
    ['home', '/'],
    ['operations', '/operations'],
    ['workflows', '/workflows/executions'],
    ['admin-roles', '/admin/roles'],
  ];

  for (const theme of ['blue', 'midnight']) {
    await page.evaluate((t) => localStorage.setItem('lt.theme', t), theme);
    for (const [w, h, label] of [[1366, 900, 'desktop'], [1024, 768, 'ipad-landscape'], [768, 1024, 'ipad-portrait']]) {
      await page.setViewportSize({ width: w, height: h });
      await page.goto(`${BASE}/escalations/available`);
      await page.waitForTimeout(1500);
      await page.screenshot({ path: `${OUT}/list-${theme}-${label}.png` });
    }
    await page.setViewportSize({ width: 1366, height: 900 });
    for (const [name, path] of PAGES) {
      await page.goto(`${BASE}${path}`);
      await page.waitForTimeout(1500);
      await page.screenshot({ path: `${OUT}/${name}-${theme}.png` });
    }
    // First escalation detail (form)
    await page.goto(`${BASE}/escalations/available`);
    await page.waitForTimeout(1500);
    const row = page.locator('table tbody tr, [data-testid="escalation-row"]').first();
    if (await row.count()) {
      await row.click();
      await page.waitForTimeout(1500);
      await page.screenshot({ path: `${OUT}/detail-${theme}.png`, fullPage: false });
    }
  }

  await browser.close();
  console.log('screenshots written to', OUT);
}

main().catch((err) => { console.error(err); process.exit(1); });
