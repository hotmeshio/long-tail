/**
 * Cross-cutting screenshot service for functional tests.
 *
 * Provides shared Playwright utilities — login, navigation, capture —
 * used by both standalone screenshot scripts and functional test companions.
 *
 * Works with raw Playwright pages (standalone scripts) and
 * @playwright/test pages (functional tests) since the Page interface
 * is compatible across both.
 */
import * as path from 'path';

// ── Types ────────────────────────────────────────────────────────────────────

/** Minimal Page interface compatible with both playwright and @playwright/test. */
export interface ScreenshotPage {
  goto(url: string, options?: { timeout?: number }): Promise<any>;
  waitForTimeout(ms: number): Promise<void>;
  waitForURL(url: string | RegExp | ((url: URL) => boolean), options?: { timeout?: number }): Promise<void>;
  screenshot(options: { path: string }): Promise<Buffer>;
  locator(selector: string): any;
  getByRole(role: string, options?: { name?: string | RegExp }): any;
  url(): string;
  context(): any;
}

export interface ScreenshotConfig {
  /** Base URL for the dashboard (default: http://localhost:3000) */
  baseUrl?: string;
  /** Output directory for screenshots */
  outputDir: string;
  /** Username for login (default: superadmin) */
  username?: string;
  /** Password for login */
  password?: string;
}

export interface CaptureResult {
  file: string;
  path: string;
}

// ── Constants ────────────────────────────────────────────────────────────────

export const DEFAULTS = {
  baseUrl: 'http://localhost:3000',
  username: 'superadmin',
  password: 'l0ngt@1l',
} as const;

export const DOCS_IMG_DIR = path.resolve(__dirname, '..', '..', 'docs', 'img');

// ── Logging ──────────────────────────────────────────────────────────────────

export function log(phase: string, message: string): void {
  const ts = new Date().toISOString().slice(11, 23);
  console.log(`  [${ts}] [${phase}] ${message}`);
}

// ── Screenshot Service ───────────────────────────────────────────────────────

export class ScreenshotService {
  private baseUrl: string;
  private outputDir: string;
  private username: string;
  private password: string;

  constructor(config: ScreenshotConfig) {
    this.baseUrl = config.baseUrl ?? DEFAULTS.baseUrl;
    this.outputDir = config.outputDir;
    this.username = config.username ?? DEFAULTS.username;
    this.password = config.password ?? DEFAULTS.password;
  }

  /** Login via the dashboard UI. Retries until seed users are available. */
  async login(page: ScreenshotPage): Promise<void> {
    const deadline = Date.now() + 90_000;
    while (Date.now() < deadline) {
      try {
        await page.goto(`${this.baseUrl}/login`, { timeout: 10_000 });
      } catch {
        log('login', 'Server not ready, retrying in 3s...');
        await page.waitForTimeout(3_000);
        continue;
      }
      await page.locator('#username').fill(this.username);
      await page.locator('#password').fill(this.password);
      await page.locator('button:has-text("Sign In")').click();
      try {
        await page.waitForURL(
          (url: URL) => !url.pathname.includes('/login'),
          { timeout: 5_000 },
        );
        return;
      } catch {
        log('login', 'Retrying login (seed not ready)...');
        await page.waitForTimeout(2_000);
      }
    }
    throw new Error(`Login timed out for ${this.username} after 90s`);
  }

  /** Navigate to a dashboard path and wait for render. */
  async navigate(page: ScreenshotPage, urlPath: string, waitMs = 1000): Promise<void> {
    await page.goto(`${this.baseUrl}${urlPath}`);
    await page.waitForTimeout(waitMs);
  }

  /** Capture a screenshot and return the result. */
  async capture(page: ScreenshotPage, filename: string, phase = 'screenshot'): Promise<CaptureResult> {
    const filePath = path.join(this.outputDir, filename);
    await page.screenshot({ path: filePath });
    log(phase, filename);
    return { file: filename, path: filePath };
  }

  /** Build a wizard step URL from a query detail URL. */
  stepUrl(queryDetailUrl: string, step: number): string {
    return queryDetailUrl.includes('?')
      ? `${queryDetailUrl}&step=${step}`
      : `${queryDetailUrl}?step=${step}`;
  }

  /** Get auth token from browser cookies for API calls. */
  async getToken(page: ScreenshotPage): Promise<string | undefined> {
    const cookies = await page.context().cookies();
    return cookies.find((c: any) => c.name === 'token')?.value;
  }

  /** Archive (if active) then delete a compiled workflow via API. */
  async deleteWorkflow(page: ScreenshotPage, id: string): Promise<void> {
    const token = await this.getToken(page);
    if (!token) return;
    const headers = {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    };
    try {
      await fetch(`${this.baseUrl}/api/yaml-workflows/${id}/archive`, {
        method: 'POST', headers,
      });
      await fetch(`${this.baseUrl}/api/yaml-workflows/${id}`, {
        method: 'DELETE', headers,
      });
      log('cleanup', `Deleted workflow ${id}`);
    } catch {
      log('cleanup', `Failed to clean up workflow ${id}`);
    }
  }

  /** Search for and delete workflows by name. */
  async cleanupWorkflowsByName(page: ScreenshotPage, name: string): Promise<void> {
    const token = await this.getToken(page);
    if (!token) return;
    try {
      const res = await fetch(
        `${this.baseUrl}/api/yaml-workflows?search=${name}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!res.ok) return;
      const { workflows } = (await res.json()) as { workflows: any[] };
      for (const wf of workflows || []) {
        if (wf.name === name) await this.deleteWorkflow(page, wf.id);
      }
    } catch { /* no leftovers */ }
  }

  get base(): string {
    return this.baseUrl;
  }
}
