import * as fs from 'fs';
import * as path from 'path';
import { type Page } from 'playwright';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { loggerRegistry } from '../../../lib/logger';

import {
  navigateSchema,
  screenshotSchema,
  clickSchema,
  fillSchema,
  waitForSchema,
  evaluateSchema,
  listPagesSchema,
  closePageSchema,
} from './schemas';
import { ensureBrowser, pages, getPage, getPageId, allocatePageId } from './lifecycle';

// Tool-handler registration for the Playwright MCP server.

export function registerTools(srv: McpServer): void {
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
      const id = allocatePageId();
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
      const result: { page_id: string; url: string; title: string }[] = [];
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
