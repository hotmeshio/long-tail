import { chromium, type Browser, type Page } from 'playwright';

import { loggerRegistry } from '../../logger';

// Browser lifecycle: shared instance across tool calls within a single
// server lifetime. Lazy-launched on first use, cleaned up via
// stopPlaywrightServer().

let browser: Browser | null = null;
export const pages = new Map<string, Page>();
let pageCounter = 0;

export async function ensureBrowser(): Promise<Browser> {
  if (!browser || !browser.isConnected()) {
    browser = await chromium.launch({ headless: true });
    loggerRegistry.info('[lt-mcp:playwright] browser launched');
  }
  return browser;
}

export function allocatePageId(): string {
  return `page_${++pageCounter}`;
}

// Page lookup helpers

export function getPage(pageId?: string): Page {
  if (pageId) {
    const page = pages.get(pageId);
    if (!page) throw new Error(`Page not found: ${pageId}`);
    return page;
  }
  const entries = Array.from(pages.entries());
  if (entries.length === 0) throw new Error('No pages open. Navigate to a URL first.');
  return entries[entries.length - 1][1];
}

export function getPageId(pageId?: string): string {
  if (pageId) return pageId;
  const entries = Array.from(pages.entries());
  if (entries.length === 0) throw new Error('No pages open');
  return entries[entries.length - 1][0];
}

// Shutdown: close all pages and the browser.

export async function stopPlaywrightServer(): Promise<void> {
  for (const [id, page] of pages) {
    try { await page.close(); } catch { /* ignore */ }
    pages.delete(id);
  }
  if (browser) {
    await browser.close();
    browser = null;
  }
  pageCounter = 0;
  loggerRegistry.info('[lt-mcp:playwright] browser closed');
}
