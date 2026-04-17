import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { z } from 'zod';

import { loggerRegistry } from '../../../lib/logger';
import { getStorageBackend } from '../../../lib/storage';

import { pages, ensureBrowser, resolvePage, buildHandle, allocatePageId } from './browser-lifecycle';
import { navigateSchema, screenshotSchema } from './schemas';
import { analyzeScreenshot } from './vision-helper';

export function registerNavigationTools(srv: McpServer): void {
  // ── navigate ─────────────────────────────────────────────
  (srv as any).registerTool(
    'navigate',
    {
      title: 'Navigate to URL',
      description:
        'Navigate to a URL. Pass page_id or _handle to reuse an existing page (preserving session/cookies). ' +
        'Without page_id, opens a NEW page — no cookies from prior pages. ' +
        'IMPORTANT: After login, always pass the page_id to maintain the authenticated session.',
      inputSchema: navigateSchema,
    },
    async (args: z.infer<typeof navigateSchema>) => {
      let page: import('playwright').Page;
      let id: string;

      // Reuse existing page if page_id or _handle provided (preserves session/cookies)
      if (args.page_id || args._handle) {
        try {
          ({ page, pageId: id } = await resolvePage(args));
        } catch (err: any) {
          if (err.code) {
            return { content: [{ type: 'text' as const, text: JSON.stringify({ error: err.message, code: err.code }) }], isError: true };
          }
          throw err;
        }
      } else {
        const b = await ensureBrowser();
        page = await b.newPage();
        id = allocatePageId();
        pages.set(id, page);
      }

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
        'Capture a screenshot and save as PNG. Accepts _handle or page_id from a prior tool call ' +
        'for cross-activity access. Pass `url` for self-contained navigate+screenshot. ' +
        'When both url and page_id are provided, navigates the EXISTING page (preserving session).',
      inputSchema: screenshotSchema,
    },
    async (args: z.infer<typeof screenshotSchema>) => {
      let page: import('playwright').Page;
      let pageId: string;

      if (args.url && (args.page_id || args._handle)) {
        // Navigate existing page to URL (preserves session/cookies), then screenshot
        try {
          ({ page, pageId } = await resolvePage(args));
          await page.goto(args.url, {
            waitUntil: args.wait_until || 'load',
            timeout: 30_000,
          });
        } catch (err: any) {
          if (err.code) {
            return { content: [{ type: 'text' as const, text: JSON.stringify({ error: err.message, code: err.code }) }], isError: true };
          }
          throw err;
        }
      } else if (args.url) {
        // Self-contained mode: new page + navigate + screenshot (no session)
        const b = await ensureBrowser();
        page = await b.newPage();
        pageId = allocatePageId();
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

      // Write screenshot via storage backend (local or S3)
      const backend = getStorageBackend();
      const localPath = await backend.getLocalPath(args.path);

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
        await element.screenshot({ path: localPath });
      } else {
        await page.screenshot({
          path: localPath,
          fullPage: args.full_page ?? false,
        });
      }

      const { size } = await backend.commitLocalPath(args.path, localPath);
      loggerRegistry.info(`[lt-mcp:playwright] screenshot saved: ${args.path} (${size} bytes)`);

      const metadata: Record<string, any> = {
        page_id: pageId,
        path: args.path,
        size_bytes: size,
        url: page.url(),
        _handle: buildHandle(pageId),
      };

      // Auto-analyze via vision LLM when requested
      if (args.describe) {
        try {
          const description = await analyzeScreenshot(args.path);
          metadata.description = description;
        } catch (err: any) {
          metadata.description = null;
          metadata.describe_error = err.message;
        }
      }

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify(metadata),
        }],
      };
    },
  );
}
