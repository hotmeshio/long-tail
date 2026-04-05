import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { z } from 'zod';

import { pages, resolvePage, buildHandle } from './browser-lifecycle';
import {
  clickSchema,
  fillSchema,
  waitForSchema,
  evaluateSchema,
  listPagesSchema,
  closePageSchema,
} from './schemas';

export function registerPageInteractionTools(srv: McpServer): void {
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
