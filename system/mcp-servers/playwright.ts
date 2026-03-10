import * as fs from 'fs';
import * as path from 'path';
import { chromium, type Browser, type Page } from 'playwright';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { loggerRegistry } from '../../services/logger';

// ── Browser lifecycle ────────────────────────────────────────────────────────
// Shared browser instance across tool calls within a single server lifetime.
// Lazy-launched on first use, cleaned up via stopPlaywrightServer().

let browser: Browser | null = null;
const pages = new Map<string, Page>();
let pageCounter = 0;

async function ensureBrowser(): Promise<Browser> {
  if (!browser || !browser.isConnected()) {
    browser = await chromium.launch({ headless: true });
    loggerRegistry.info('[lt-mcp:playwright] browser launched');
  }
  return browser;
}

// ── Schemas (extracted to break TS2589 deep-instantiation) ───────────────────

const navigateSchema = z.object({
  url: z.string().describe('URL to navigate to'),
  wait_until: z.enum(['load', 'domcontentloaded', 'networkidle']).optional()
    .describe('When to consider navigation complete (default: load)'),
});

const screenshotSchema = z.object({
  page_id: z.string().optional()
    .describe('Page to screenshot (default: most recent)'),
  path: z.string()
    .describe('File path to save the screenshot PNG'),
  full_page: z.boolean().optional()
    .describe('Capture the full scrollable page (default: false)'),
  selector: z.string().optional()
    .describe('CSS selector to screenshot a specific element'),
});

const clickSchema = z.object({
  page_id: z.string().optional()
    .describe('Page to act on (default: most recent)'),
  selector: z.string().describe('CSS selector of the element to click'),
});

const fillSchema = z.object({
  page_id: z.string().optional()
    .describe('Page to act on (default: most recent)'),
  selector: z.string().describe('CSS selector of the input element'),
  value: z.string().describe('Value to type into the input'),
});

const waitForSchema = z.object({
  page_id: z.string().optional()
    .describe('Page to act on (default: most recent)'),
  selector: z.string().describe('CSS selector to wait for'),
  timeout: z.number().optional()
    .describe('Max wait time in ms (default: 10000)'),
});

const evaluateSchema = z.object({
  page_id: z.string().optional()
    .describe('Page to act on (default: most recent)'),
  script: z.string()
    .describe('JavaScript expression to evaluate in the page context'),
});

const listPagesSchema = z.object({});

const closePageSchema = z.object({
  page_id: z.string().describe('Page ID to close'),
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function getPage(pageId?: string): Page {
  if (pageId) {
    const page = pages.get(pageId);
    if (!page) throw new Error(`Page not found: ${pageId}`);
    return page;
  }
  // Return the most recently created page
  const entries = Array.from(pages.entries());
  if (entries.length === 0) throw new Error('No pages open. Navigate to a URL first.');
  return entries[entries.length - 1][1];
}

function getPageId(pageId?: string): string {
  if (pageId) return pageId;
  const entries = Array.from(pages.entries());
  if (entries.length === 0) throw new Error('No pages open');
  return entries[entries.length - 1][0];
}

// ── Tool registration ────────────────────────────────────────────────────────

function registerTools(srv: McpServer): void {
  // ── navigate ─────────────────────────────────────────────
  (srv as any).registerTool(
    'navigate',
    {
      title: 'Navigate to URL',
      description: 'Open a URL in a new browser page. Returns the page ID for subsequent tool calls.',
      inputSchema: navigateSchema,
    },
    async (args: z.infer<typeof navigateSchema>) => {
      const b = await ensureBrowser();
      const page = await b.newPage();
      const id = `page_${++pageCounter}`;
      pages.set(id, page);

      await page.goto(args.url, {
        waitUntil: args.wait_until || 'load',
        timeout: 30_000,
      });

      const title = await page.title();
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ page_id: id, url: args.url, title }),
        }],
      };
    },
  );

  // ── screenshot ───────────────────────────────────────────
  (srv as any).registerTool(
    'screenshot',
    {
      title: 'Take Screenshot',
      description: 'Capture a screenshot of the current page (or a specific element) and save it as a PNG file.',
      inputSchema: screenshotSchema,
    },
    async (args: z.infer<typeof screenshotSchema>) => {
      const page = getPage(args.page_id);
      const pageId = getPageId(args.page_id);

      // Ensure output directory exists
      const dir = path.dirname(args.path);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      if (args.selector) {
        const element = await page.$(args.selector);
        if (!element) {
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({ error: `Element not found: ${args.selector}` }),
            }],
            isError: true,
          };
        }
        await element.screenshot({ path: args.path });
      } else {
        await page.screenshot({
          path: args.path,
          fullPage: args.full_page ?? false,
        });
      }

      const stats = fs.statSync(args.path);
      loggerRegistry.info(`[lt-mcp:playwright] screenshot saved: ${args.path} (${stats.size} bytes)`);

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            page_id: pageId,
            path: args.path,
            size_bytes: stats.size,
            url: page.url(),
          }),
        }],
      };
    },
  );

  // ── click ────────────────────────────────────────────────
  (srv as any).registerTool(
    'click',
    {
      title: 'Click Element',
      description: 'Click an element on the page by CSS selector.',
      inputSchema: clickSchema,
    },
    async (args: z.infer<typeof clickSchema>) => {
      const page = getPage(args.page_id);
      await page.click(args.selector, { timeout: 10_000 });
      // Brief wait for any navigation or rendering
      await page.waitForTimeout(500);
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            clicked: args.selector,
            url: page.url(),
            title: await page.title(),
          }),
        }],
      };
    },
  );

  // ── fill ─────────────────────────────────────────────────
  (srv as any).registerTool(
    'fill',
    {
      title: 'Fill Input',
      description: 'Type a value into an input field by CSS selector. Clears existing content first.',
      inputSchema: fillSchema,
    },
    async (args: z.infer<typeof fillSchema>) => {
      const page = getPage(args.page_id);
      await page.fill(args.selector, args.value, { timeout: 10_000 });
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ filled: args.selector, value: args.value }),
        }],
      };
    },
  );

  // ── wait_for ─────────────────────────────────────────────
  (srv as any).registerTool(
    'wait_for',
    {
      title: 'Wait for Element',
      description: 'Wait for an element to appear on the page. Useful after navigation or async operations.',
      inputSchema: waitForSchema,
    },
    async (args: z.infer<typeof waitForSchema>) => {
      const page = getPage(args.page_id);
      await page.waitForSelector(args.selector, {
        timeout: args.timeout ?? 10_000,
      });
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ found: args.selector }),
        }],
      };
    },
  );

  // ── evaluate ─────────────────────────────────────────────
  (srv as any).registerTool(
    'evaluate',
    {
      title: 'Run JavaScript',
      description: 'Evaluate a JavaScript expression in the page context. Returns the serialized result.',
      inputSchema: evaluateSchema,
    },
    async (args: z.infer<typeof evaluateSchema>) => {
      const page = getPage(args.page_id);
      const result = await page.evaluate(args.script);
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ result }),
        }],
      };
    },
  );

  // ── list_pages ───────────────────────────────────────────
  (srv as any).registerTool(
    'list_pages',
    {
      title: 'List Open Pages',
      description: 'List all open browser pages with their IDs, URLs, and titles.',
      inputSchema: listPagesSchema,
    },
    async (_args: z.infer<typeof listPagesSchema>) => {
      const result = [];
      for (const [id, page] of pages) {
        result.push({
          page_id: id,
          url: page.url(),
          title: await page.title(),
        });
      }
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ pages: result, count: result.length }),
        }],
      };
    },
  );

  // ── close_page ───────────────────────────────────────────
  (srv as any).registerTool(
    'close_page',
    {
      title: 'Close Page',
      description: 'Close a browser page by its ID.',
      inputSchema: closePageSchema,
    },
    async (args: z.infer<typeof closePageSchema>) => {
      const page = pages.get(args.page_id);
      if (!page) {
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ error: `Page not found: ${args.page_id}` }),
          }],
          isError: true,
        };
      }
      await page.close();
      pages.delete(args.page_id);
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ closed: args.page_id }),
        }],
      };
    },
  );
}

// ── Factory ──────────────────────────────────────────────────────────────────

/**
 * Create a Playwright Browser MCP server.
 *
 * Provides 8 tools for browser automation:
 *   navigate, screenshot, click, fill, wait_for, evaluate, list_pages, close_page
 *
 * Returns a fresh McpServer instance each time. The browser is shared
 * and lazy-launched on first tool call.
 */
export async function createPlaywrightServer(options?: {
  name?: string;
}): Promise<McpServer> {
  const name = options?.name || 'long-tail-playwright';
  const instance = new McpServer({ name, version: '1.0.0' });
  registerTools(instance);
  loggerRegistry.info(`[lt-mcp:playwright] ${name} ready (8 tools registered)`);
  return instance;
}

/**
 * Shut down the shared browser and release all pages.
 */
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
