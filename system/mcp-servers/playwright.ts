import * as fs from 'fs';
import * as path from 'path';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { loggerRegistry } from '../../services/logger';

// All file output (screenshots, etc.) is routed through the managed file-storage directory
// so files are visible to list_files / read_file tools and served via GET /api/files/*.
const FILE_STORAGE_DIR = process.env.LT_FILE_STORAGE_DIR || './data/files';

function resolveToStorage(filePath: string): string {
  // Strip leading slash to make it relative, then resolve against storage dir
  const relative = filePath.replace(/^\/+/, '');
  const resolved = path.resolve(FILE_STORAGE_DIR, relative);
  const base = path.resolve(FILE_STORAGE_DIR);
  if (!resolved.startsWith(base + path.sep) && resolved !== base) {
    throw new Error(`Path traversal denied: ${filePath}`);
  }
  return resolved;
}

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

// ── _handle convention ──────────────────────────────────────────────────────
//
// Tools that create external state (browser pages, file handles, connections)
// return a `_handle` object in their result. The handle contains everything
// needed to locate the resource from any container:
//
//   _handle: {
//     type: "playwright_page",
//     cdp_endpoint: "ws://host:port/...",   // CDP WebSocket (cross-container)
//     page_id: "page_3",                     // local in-memory lookup (fast path)
//   }
//
// Subsequent tools accept `_handle` and use it to reconnect:
// 1. Fast path: check local `pages` Map by page_id (same container)
// 2. Slow path: connect via CDP endpoint (different container / cloud)
//
// The YAML generator threads `_handle` automatically between sequential
// activities from the same server. No hardcoded tool-pair knowledge needed.

// ── Standard error codes for stateful resource tools ────────────────────────
// Any MCP server managing stateful resources should use these codes:
//   SESSION_NOT_FOUND    — resource ID unknown (never existed or already cleaned up)
//   SESSION_EXPIRED      — resource was closed / cleaned up
//   SESSION_UNREACHABLE  — remote endpoint (e.g. CDP) not reachable
//   RESOURCE_NOT_FOUND   — sub-resource (element, file) not found within session
const SESSION_NOT_FOUND = 'SESSION_NOT_FOUND';
const SESSION_UNREACHABLE = 'SESSION_UNREACHABLE';
const RESOURCE_NOT_FOUND = 'RESOURCE_NOT_FOUND';

interface PlaywrightHandle {
  type: 'playwright_page';
  cdp_endpoint?: string;
  page_id: string;
}

/** Remote browsers connected via CDP — cached to avoid reconnecting per call. */
const remoteBrowsers = new Map<string, Browser>();

/**
 * Resolve a page from either a local `page_id`, a `_handle`, or "most recent".
 * Handles cross-container reconnection via CDP when needed.
 */
async function resolvePage(args: { page_id?: string; _handle?: PlaywrightHandle }): Promise<{ page: Page; pageId: string }> {
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
function buildHandle(pageId: string): PlaywrightHandle {
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

// ── Schemas (extracted to break TS2589 deep-instantiation) ───────────────────

// _handle is accepted by all page-scoped tools. The YAML generator auto-threads
// it between activities. Agentic (LLM) callers can ignore it — page_id works.
const handleProp = z.object({
  type: z.literal('playwright_page'),
  cdp_endpoint: z.string().optional(),
  page_id: z.string(),
}).optional().describe('Resource handle from a prior Playwright tool call. Enables cross-activity page access.');

const navigateSchema = z.object({
  url: z.string().describe('URL to navigate to'),
  wait_until: z.enum(['load', 'domcontentloaded', 'networkidle']).optional()
    .describe('When to consider navigation complete (default: load)'),
});

const screenshotSchema = z.object({
  _handle: handleProp,
  url: z.string().optional()
    .describe('URL to navigate to before screenshotting. Self-contained — no prior navigate needed.'),
  wait_until: z.enum(['load', 'domcontentloaded', 'networkidle']).optional()
    .describe('When to consider navigation complete — only used with url (default: load)'),
  page_id: z.string().optional()
    .describe('Page to screenshot (default: most recent). Ignored if url is provided.'),
  path: z.string()
    .describe('File path to save the screenshot PNG'),
  full_page: z.boolean().optional()
    .describe('Capture the full scrollable page (default: false)'),
  selector: z.string().optional()
    .describe('CSS selector to screenshot a specific element'),
});

const clickSchema = z.object({
  _handle: handleProp,
  page_id: z.string().optional()
    .describe('Page to act on (default: most recent)'),
  selector: z.string().describe('CSS selector of the element to click'),
});

const fillSchema = z.object({
  _handle: handleProp,
  page_id: z.string().optional()
    .describe('Page to act on (default: most recent)'),
  selector: z.string().describe('CSS selector of the input element'),
  value: z.string().describe('Value to type into the input'),
});

const waitForSchema = z.object({
  _handle: handleProp,
  page_id: z.string().optional()
    .describe('Page to act on (default: most recent)'),
  selector: z.string().describe('CSS selector to wait for'),
  timeout: z.number().optional()
    .describe('Max wait time in ms (default: 10000)'),
});

const evaluateSchema = z.object({
  _handle: handleProp,
  page_id: z.string().optional()
    .describe('Page to act on (default: most recent)'),
  script: z.string()
    .describe('JavaScript expression to evaluate in the page context'),
});

const listPagesSchema = z.object({});

const closePageSchema = z.object({
  _handle: handleProp,
  page_id: z.string().describe('Page ID to close'),
});

const runScriptStepSchema = z.object({
  action: z.enum(['navigate', 'screenshot', 'click', 'fill', 'wait_for', 'evaluate'])
    .describe('Browser action to perform'),
  url: z.string().optional().describe('URL for navigate action'),
  wait_until: z.enum(['load', 'domcontentloaded', 'networkidle']).optional()
    .describe('Navigation wait strategy (default: load)'),
  path: z.string().optional().describe('File path for screenshot action'),
  full_page: z.boolean().optional().describe('Full-page screenshot (default: false)'),
  selector: z.string().optional().describe('CSS selector for click/fill/wait_for/screenshot'),
  value: z.string().optional().describe('Value for fill action'),
  script: z.string().optional().describe('JavaScript for evaluate action'),
  timeout: z.number().optional().describe('Timeout in ms for wait_for action'),
});

const runScriptSchema = z.object({
  _handle: handleProp,
  steps: z.array(runScriptStepSchema)
    .describe('Ordered list of browser actions to execute sequentially on a single page. ' +
      'Preferred for deterministic YAML workflows — encapsulates an entire browser interaction in one activity.'),
});

// ── Tool registration ────────────────────────────────────────────────────────

function registerTools(srv: McpServer): void {
  // ── navigate ─────────────────────────────────────────────
  (srv as any).registerTool(
    'navigate',
    {
      title: 'Navigate to URL',
      description: 'Open a URL in a new browser page. Returns a _handle for cross-activity page access.',
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
          text: JSON.stringify({
            page_id: id,
            url: args.url,
            title,
            _handle: buildHandle(id),
          }),
        }],
      };
    },
  );

  // ── screenshot ───────────────────────────────────────────
  (srv as any).registerTool(
    'screenshot',
    {
      title: 'Take Screenshot',
      description:
        'Capture a screenshot and save as PNG. Accepts _handle from a prior navigate ' +
        'for cross-activity access, or pass `url` for self-contained navigate+screenshot.',
      inputSchema: screenshotSchema,
    },
    async (args: z.infer<typeof screenshotSchema>) => {
      let page: Page;
      let pageId: string;

      if (args.url) {
        // Self-contained mode: navigate + screenshot in one call
        const b = await ensureBrowser();
        page = await b.newPage();
        pageId = `page_${++pageCounter}`;
        pages.set(pageId, page);
        await page.goto(args.url, {
          waitUntil: args.wait_until || 'load',
          timeout: 30_000,
        });
      } else {
        // Use _handle or page_id to find existing page
        try {
          ({ page, pageId } = await resolvePage(args));
        } catch (err: any) {
          if (err.code) {
            return { content: [{ type: 'text' as const, text: JSON.stringify({ error: err.message, code: err.code }) }], isError: true };
          }
          throw err;
        }
      }

      // Resolve path into managed file-storage directory
      const storagePath = resolveToStorage(args.path);
      const dir = path.dirname(storagePath);
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
        await element.screenshot({ path: storagePath });
      } else {
        await page.screenshot({
          path: storagePath,
          fullPage: args.full_page ?? false,
        });
      }

      const stats = fs.statSync(storagePath);
      loggerRegistry.info(`[lt-mcp:playwright] screenshot saved: ${args.path} (${stats.size} bytes)`);

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            page_id: pageId,
            path: args.path,
            size_bytes: stats.size,
            url: page.url(),
            _handle: buildHandle(pageId),
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
      description: 'Click an element on the page by CSS selector. Accepts _handle for cross-activity access.',
      inputSchema: clickSchema,
    },
    async (args: z.infer<typeof clickSchema>) => {
      try {
        const { page, pageId } = await resolvePage(args);
        await page.click(args.selector, { timeout: 10_000 });
        await page.waitForTimeout(500);
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              clicked: args.selector,
              url: page.url(),
              title: await page.title(),
              _handle: buildHandle(pageId),
            }),
          }],
        };
      } catch (err: any) {
        if (err.code) {
          return { content: [{ type: 'text' as const, text: JSON.stringify({ error: err.message, code: err.code }) }], isError: true };
        }
        throw err;
      }
    },
  );

  // ── fill ─────────────────────────────────────────────────
  (srv as any).registerTool(
    'fill',
    {
      title: 'Fill Input',
      description: 'Type a value into an input field. Accepts _handle for cross-activity access.',
      inputSchema: fillSchema,
    },
    async (args: z.infer<typeof fillSchema>) => {
      try {
        const { page, pageId } = await resolvePage(args);
        await page.fill(args.selector, args.value, { timeout: 10_000 });
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              filled: args.selector,
              value: args.value,
              _handle: buildHandle(pageId),
            }),
          }],
        };
      } catch (err: any) {
        if (err.code) {
          return { content: [{ type: 'text' as const, text: JSON.stringify({ error: err.message, code: err.code }) }], isError: true };
        }
        throw err;
      }
    },
  );

  // ── wait_for ─────────────────────────────────────────────
  (srv as any).registerTool(
    'wait_for',
    {
      title: 'Wait for Element',
      description: 'Wait for an element to appear. Accepts _handle for cross-activity access.',
      inputSchema: waitForSchema,
    },
    async (args: z.infer<typeof waitForSchema>) => {
      try {
        const { page, pageId } = await resolvePage(args);
        await page.waitForSelector(args.selector, {
          timeout: args.timeout ?? 10_000,
        });
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              found: args.selector,
              _handle: buildHandle(pageId),
            }),
          }],
        };
      } catch (err: any) {
        if (err.code) {
          return { content: [{ type: 'text' as const, text: JSON.stringify({ error: err.message, code: err.code }) }], isError: true };
        }
        throw err;
      }
    },
  );

  // ── evaluate ─────────────────────────────────────────────
  (srv as any).registerTool(
    'evaluate',
    {
      title: 'Run JavaScript',
      description: 'Evaluate JavaScript in the page context. Accepts _handle for cross-activity access.',
      inputSchema: evaluateSchema,
    },
    async (args: z.infer<typeof evaluateSchema>) => {
      try {
        const { page, pageId } = await resolvePage(args);
        const result = await page.evaluate(args.script);
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              result,
              _handle: buildHandle(pageId),
            }),
          }],
        };
      } catch (err: any) {
        if (err.code) {
          return { content: [{ type: 'text' as const, text: JSON.stringify({ error: err.message, code: err.code }) }], isError: true };
        }
        throw err;
      }
    },
  );

  // ── run_script ─────────────────────────────────────────────
  (srv as any).registerTool(
    'run_script',
    {
      title: 'Run Browser Script',
      description:
        'Execute a multi-step browser script (navigate, screenshot, click, fill, etc.) ' +
        'in a single call. All steps share one page — no cross-activity session issues. ' +
        'Preferred for deterministic YAML workflows.',
      inputSchema: runScriptSchema,
    },
    async (args: z.infer<typeof runScriptSchema>) => {
      let page: Page;
      let pageId: string;

      // Reuse existing page via _handle, or create a new one on first navigate
      if (args._handle) {
        try {
          ({ page, pageId } = await resolvePage(args));
        } catch {
          // If handle resolution fails, we'll create a new page on first navigate
          page = null as any;
          pageId = '';
        }
      } else {
        page = null as any;
        pageId = '';
      }

      const stepResults: Array<{ step: number; action: string; result: Record<string, unknown> }> = [];

      for (let i = 0; i < args.steps.length; i++) {
        const step = args.steps[i];

        // Auto-create page on first navigate (or if no page yet)
        if (step.action === 'navigate') {
          if (!step.url) {
            return {
              content: [{ type: 'text' as const, text: JSON.stringify({
                error: `Step ${i}: navigate requires url`,
                code: RESOURCE_NOT_FOUND,
              }) }],
              isError: true,
            };
          }
          const b = await ensureBrowser();
          page = await b.newPage();
          pageId = `page_${++pageCounter}`;
          pages.set(pageId, page);
          await page.goto(step.url, {
            waitUntil: step.wait_until || 'load',
            timeout: 30_000,
          });
          stepResults.push({
            step: i,
            action: 'navigate',
            result: { url: step.url, title: await page.title() },
          });
          continue;
        }

        // All other actions require a page
        if (!page) {
          return {
            content: [{ type: 'text' as const, text: JSON.stringify({
              error: `Step ${i}: no page available. Start with a navigate step or provide a _handle.`,
              code: SESSION_NOT_FOUND,
            }) }],
            isError: true,
          };
        }

        switch (step.action) {
          case 'screenshot': {
            if (!step.path) {
              return {
                content: [{ type: 'text' as const, text: JSON.stringify({
                  error: `Step ${i}: screenshot requires path`,
                  code: RESOURCE_NOT_FOUND,
                }) }],
                isError: true,
              };
            }
            const storagePath = resolveToStorage(step.path);
            const dir = path.dirname(storagePath);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            if (step.selector) {
              const el = await page.$(step.selector);
              if (!el) {
                stepResults.push({ step: i, action: 'screenshot', result: { error: `Element not found: ${step.selector}`, code: RESOURCE_NOT_FOUND } });
                continue;
              }
              await el.screenshot({ path: storagePath });
            } else {
              await page.screenshot({ path: storagePath, fullPage: step.full_page ?? false });
            }
            const stats = fs.statSync(storagePath);
            loggerRegistry.info(`[lt-mcp:playwright] screenshot saved: ${step.path} (${stats.size} bytes)`);
            stepResults.push({ step: i, action: 'screenshot', result: { path: step.path, size_bytes: stats.size, url: page.url() } });
            break;
          }
          case 'click': {
            if (!step.selector) {
              return {
                content: [{ type: 'text' as const, text: JSON.stringify({ error: `Step ${i}: click requires selector`, code: RESOURCE_NOT_FOUND }) }],
                isError: true,
              };
            }
            await page.click(step.selector, { timeout: 10_000 });
            await page.waitForTimeout(500);
            stepResults.push({ step: i, action: 'click', result: { clicked: step.selector, url: page.url() } });
            break;
          }
          case 'fill': {
            if (!step.selector || step.value === undefined) {
              return {
                content: [{ type: 'text' as const, text: JSON.stringify({ error: `Step ${i}: fill requires selector and value`, code: RESOURCE_NOT_FOUND }) }],
                isError: true,
              };
            }
            await page.fill(step.selector, step.value, { timeout: 10_000 });
            stepResults.push({ step: i, action: 'fill', result: { filled: step.selector, value: step.value } });
            break;
          }
          case 'wait_for': {
            if (!step.selector) {
              return {
                content: [{ type: 'text' as const, text: JSON.stringify({ error: `Step ${i}: wait_for requires selector`, code: RESOURCE_NOT_FOUND }) }],
                isError: true,
              };
            }
            await page.waitForSelector(step.selector, { timeout: step.timeout ?? 10_000 });
            stepResults.push({ step: i, action: 'wait_for', result: { found: step.selector } });
            break;
          }
          case 'evaluate': {
            if (!step.script) {
              return {
                content: [{ type: 'text' as const, text: JSON.stringify({ error: `Step ${i}: evaluate requires script`, code: RESOURCE_NOT_FOUND }) }],
                isError: true,
              };
            }
            const evalResult = await page.evaluate(step.script);
            stepResults.push({ step: i, action: 'evaluate', result: { result: evalResult } });
            break;
          }
        }
      }

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            steps_completed: stepResults.length,
            steps: stepResults,
            page_id: pageId,
            url: page?.url?.() ?? null,
            _handle: pageId ? buildHandle(pageId) : undefined,
          }),
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
      description: 'Close a browser page by its ID. Accepts _handle for cross-activity access.',
      inputSchema: closePageSchema,
    },
    async (args: z.infer<typeof closePageSchema>) => {
      try {
        const { page, pageId } = await resolvePage(args);
        await page.close();
        pages.delete(pageId);
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ closed: pageId }),
          }],
        };
      } catch (err: any) {
        if (err.code) {
          return { content: [{ type: 'text' as const, text: JSON.stringify({ error: err.message, code: err.code }) }], isError: true };
        }
        throw err;
      }
    },
  );
}

// ── Factory ──────────────────────────────────────────────────────────────────

/**
 * Create a Playwright Browser MCP server.
 *
 * Provides 9 tools for browser automation:
 *   navigate, screenshot, click, fill, wait_for, evaluate, run_script, list_pages, close_page
 *
 * All page-scoped tools participate in the _handle convention:
 * - navigate returns a _handle in its result
 * - All other tools accept _handle to locate the page across activities
 * - Fast path: local pages Map (same container)
 * - Slow path: CDP reconnection (different container)
 *
 * `run_script` is the preferred tool for YAML workflows — it executes a
 * multi-step browser script in a single activity, avoiding cross-activity
 * session issues entirely.
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
  loggerRegistry.info(`[lt-mcp:playwright] ${name} ready (9 tools registered)`);
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
