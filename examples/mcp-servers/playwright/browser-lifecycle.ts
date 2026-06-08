import { chromium, type Browser, type Page } from 'playwright';

import { loggerRegistry } from '../../../lib/logger';

import type { PlaywrightHandle } from './types';
import { SESSION_NOT_FOUND, SESSION_UNREACHABLE } from './types';

// ── Browser lifecycle ────────────────────────────────────────────────────────
// Shared browser instance across tool calls within a single server lifetime.
// Lazy-launched on first use, cleaned up via stopPlaywrightServer().

let browser: Browser | null = null;
export const pages = new Map<string, Page>();
let pageCounter = 0;

/** Remote browsers connected via CDP — cached to avoid reconnecting per call. */
const remoteBrowsers = new Map<string, Browser>();

/** Allocate a unique page ID (shared across both playwright servers). */
export function allocatePageId(): string {
  return `page_${++pageCounter}`;
}

export async function ensureBrowser(): Promise<Browser> {
  if (!browser || !browser.isConnected()) {
    browser = await chromium.launch({ headless: true });
    loggerRegistry.info('[lt-mcp:playwright] browser launched');
  }
  return browser;
}

/**
 * Resolve a page from either a local `page_id`, a `_handle`, or "most recent".
 * Handles cross-container reconnection via CDP when needed.
 */
export async function resolvePage(args: { page_id?: string; _handle?: PlaywrightHandle }): Promise<{ page: Page; pageId: string }> {
  // 1. Try local pages Map (fast path — same container)
  const localId = args._handle?.page_id || args.page_id;
  if (localId) {
    const local = pages.get(localId);
    if (local) return { page: local, pageId: localId };
  }

  // 2. Try CDP reconnection via handle (cross-container)
  if (args._handle?.cdp_endpoint) {
    const cdp = args._handle.cdp_endpoint;
    let remoteBrowser = remoteBrowsers.get(cdp);
    if (!remoteBrowser || !remoteBrowser.isConnected()) {
      try {
        remoteBrowser = await chromium.connectOverCDP(cdp);
        remoteBrowsers.set(cdp, remoteBrowser);
        loggerRegistry.info(`[lt-mcp:playwright] connected to remote browser: ${cdp}`);
      } catch (err) {
        throw Object.assign(
          new Error(`Cannot reach browser at ${cdp}`),
          { code: SESSION_UNREACHABLE, cdp_endpoint: cdp },
        );
      }
    }
    // Find the page — for now, use the first page in the default context
    const contexts = remoteBrowser.contexts();
    const ctx = contexts[0] || await remoteBrowser.newContext();
    const remotePages = ctx.pages();
    if (remotePages.length > 0) {
      const page = remotePages[remotePages.length - 1];
      const id = args._handle.page_id || `remote_${++pageCounter}`;
      pages.set(id, page);
      return { page, pageId: id };
    }
    throw Object.assign(
      new Error(`No pages found on remote browser at ${cdp}`),
      { code: SESSION_NOT_FOUND, cdp_endpoint: cdp },
    );
  }

  // 3. If a specific page_id was requested but not found, throw structured error
  if (localId) {
    throw Object.assign(
      new Error(`Page ${localId} not found`),
      { code: SESSION_NOT_FOUND, page_id: localId },
    );
  }

  // 4. Fall back to most recent local page
  const entries = Array.from(pages.entries());
  if (entries.length === 0) {
    throw Object.assign(
      new Error('No pages open. Navigate to a URL first, or pass a _handle.'),
      { code: SESSION_NOT_FOUND },
    );
  }
  return { page: entries[entries.length - 1][1], pageId: entries[entries.length - 1][0] };
}

/**
 * Build a _handle for a page. Includes CDP endpoint when available
 * (for cross-container access in distributed deployments).
 */
export function buildHandle(pageId: string): PlaywrightHandle {
  const handle: PlaywrightHandle = {
    type: 'playwright_page',
    page_id: pageId,
  };
  // Include CDP endpoint if browser exposes one (e.g., launchServer or remote)
  if (browser && typeof (browser as any).wsEndpoint === 'function') {
    try {
      handle.cdp_endpoint = (browser as any).wsEndpoint();
    } catch {
      // Not available — single-process mode, local pages Map suffices
    }
  }
  return handle;
}

/**
 * Shut down the shared browser and release all pages.
 */
export async function stopPlaywrightServer(): Promise<void> {
  for (const [id, page] of pages) {
    try { await page.close(); } catch { /* ignore */ }
    pages.delete(id);
  }
  // Close remote browsers
  for (const [endpoint, rb] of remoteBrowsers) {
    try { await rb.close(); } catch { /* ignore */ }
    remoteBrowsers.delete(endpoint);
  }
  if (browser) {
    await browser.close();
    browser = null;
  }
  pageCounter = 0;
  loggerRegistry.info('[lt-mcp:playwright] browser closed');
}
