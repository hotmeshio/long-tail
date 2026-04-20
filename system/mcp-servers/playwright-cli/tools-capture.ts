import * as path from 'path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { loggerRegistry } from '../../../lib/logger';
import {
  ensureBrowser,
  pages,
  allocatePageId,
  buildHandle,
} from '../playwright';

import { capturePageSchema, extractContentSchema, submitFormSchema } from './schemas';
import { saveScreenshot, errorResult } from './helpers';

export function registerCaptureTools(srv: McpServer): void {

  // capture_page
  (srv as any).registerTool(
    'capture_page',
    {
      title: 'Capture Page',
      description:
        'Navigate to a URL, capture a screenshot, and save it to persistent file storage in one call. ' +
        'The returned `path` is the storage reference — no separate write_file call is needed. ' +
        'Optionally waits for a CSS selector or a fixed delay to ensure content is loaded. ' +
        'Pass page_id from a prior login_and_capture to reuse the authenticated session.',
      inputSchema: capturePageSchema,
    },
    async (args: z.infer<typeof capturePageSchema>) => {
      try {
        let page: import('playwright').Page;
        let pageId: string;

        if (args.page_id && pages.has(args.page_id)) {
          const existingPage = pages.get(args.page_id)!;
          try {
            await existingPage.evaluate('1');
            page = existingPage;
            pageId = args.page_id;
          } catch {
            pages.delete(args.page_id);
            const b = await ensureBrowser();
            page = await b.newPage();
            pageId = allocatePageId();
            pages.set(pageId, page);
          }
        } else {
          const b = await ensureBrowser();
          page = await b.newPage();
          pageId = allocatePageId();
          pages.set(pageId, page);
        }

        await page.goto(args.url, {
          waitUntil: args.wait_until || 'load',
          timeout: args.timeout ?? 30_000,
        });

        if (args.wait_for_selector) {
          await page.waitForSelector(args.wait_for_selector, { timeout: args.timeout ?? 10_000 });
        } else {
          await page.waitForTimeout(args.wait_ms ?? 2000);
        }

        // Auto-derive screenshot path from URL if not provided
        let screenshotPath = args.screenshot_path || (() => {
          try {
            const urlPath = new URL(args.url).pathname;
            const slug = urlPath === '/' ? 'home' : urlPath.replace(/^\/+|\/+$/g, '').replace(/\//g, '-');
            return `screenshots/${slug || 'page'}.png`;
          } catch {
            return `screenshots/capture-${Date.now()}.png`;
          }
        })();
        // Ensure file extension — storage backends require mime type
        if (!path.extname(screenshotPath)) {
          screenshotPath += '.png';
        }

        const screenshot = await saveScreenshot(page, screenshotPath, args.full_page ?? true);

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              page_id: pageId,
              url: page.url(),
              title: await page.title(),
              ...screenshot,
              storage_ref: screenshot.path,
              _handle: buildHandle(pageId),
            }),
          }],
        };
      } catch (err: any) {
        return errorResult(err.message, err.name === 'TimeoutError' ? 'TIMEOUT' : 'CAPTURE_FAILED');
      }
    },
  );

  // extract_content
  (srv as any).registerTool(
    'extract_content',
    {
      title: 'Extract Content',
      description:
        'Navigate to a URL and extract structured content. ' +
        'Extracts page title and text by default. Optionally extracts links, metadata, ' +
        'text from a specific CSS selector, or runs custom JavaScript.',
      inputSchema: extractContentSchema,
    },
    async (args: z.infer<typeof extractContentSchema>) => {
      try {
        let page: import('playwright').Page;
        let pageId: string;

        if (args.page_id && pages.has(args.page_id)) {
          // Reuse existing page (e.g., from login_and_capture)
          const existingPage = pages.get(args.page_id)!;
          // Verify page is still usable (not closed)
          try {
            await existingPage.evaluate('1');
            page = existingPage;
            pageId = args.page_id;
            if (args.url) {
              await page.goto(args.url, { waitUntil: 'load', timeout: args.timeout ?? 30_000 });
            }
          } catch {
            // Page is stale/closed — clean it up and fall through to create new page
            pages.delete(args.page_id);
            loggerRegistry.info(`[lt-mcp:playwright-cli] extract_content: page_id ${args.page_id} is stale, creating fresh page`);
            if (!args.url) {
              return errorResult('page_id is stale and no url provided as fallback', 'STALE_PAGE');
            }
            const b = await ensureBrowser();
            page = await b.newPage();
            pageId = allocatePageId();
            pages.set(pageId, page);
            await page.goto(args.url, { waitUntil: 'load', timeout: args.timeout ?? 30_000 });
          }
        } else {
          if (!args.url) {
            return errorResult('Either url or a valid page_id is required', 'MISSING_PARAMS');
          }
          const b = await ensureBrowser();
          page = await b.newPage();
          pageId = allocatePageId();
          pages.set(pageId, page);
          await page.goto(args.url, { waitUntil: 'load', timeout: args.timeout ?? 30_000 });
        }

        if (args.wait_for_selector) {
          await page.waitForSelector(args.wait_for_selector, { timeout: args.timeout ?? 10_000 });
        } else {
          await page.waitForTimeout(args.wait_ms ?? 1000);
        }

        const result: Record<string, unknown> = {
          url: page.url(),
          title: await page.title(),
        };

        // Extract text from selector
        if (args.selector) {
          result.content = await page.$$eval(args.selector, (els) =>
            els.map((el) => (el as HTMLElement).innerText).join('\n'),
          );
        } else {
          result.content = await page.evaluate(() =>
            document.body.innerText.slice(0, 5000),
          );
        }

        // Custom script
        if (args.script) {
          result.script_result = await page.evaluate(args.script);
        }

        // Links
        if (args.extract_links) {
          result.links = await page.$$eval('a[href]', (els) =>
            els.map((a) => ({ text: a.textContent?.trim(), href: (a as HTMLAnchorElement).href }))
              .filter((l) => l.href && !l.href.startsWith('javascript:')),
          );
        }

        // Metadata
        if (args.extract_metadata) {
          result.metadata = await page.evaluate(() => ({
            title: document.title,
            description: document.querySelector('meta[name="description"]')?.getAttribute('content'),
            og_title: document.querySelector('meta[property="og:title"]')?.getAttribute('content'),
            og_description: document.querySelector('meta[property="og:description"]')?.getAttribute('content'),
            og_image: document.querySelector('meta[property="og:image"]')?.getAttribute('content'),
          }));
        }

        result.page_id = pageId;
        result._handle = buildHandle(pageId);

        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result) }],
        };
      } catch (err: any) {
        return errorResult(err.message, err.name === 'TimeoutError' ? 'TIMEOUT' : 'EXTRACT_FAILED');
      }
    },
  );

  // submit_form
  (srv as any).registerTool(
    'submit_form',
    {
      title: 'Submit Form',
      description:
        'Navigate to a form page, fill multiple fields, submit, and capture the result. ' +
        'Handles navigation, field filling, form submission, and post-submit waiting in one call.',
      inputSchema: submitFormSchema,
    },
    async (args: z.infer<typeof submitFormSchema>) => {
      try {
        const b = await ensureBrowser();
        const page = await b.newPage();
        const pageId = allocatePageId();
        pages.set(pageId, page);

        const timeout = args.timeout ?? 30_000;

        await page.goto(args.url, { waitUntil: 'load', timeout });

        // Fill all fields
        for (const field of args.fields) {
          await page.fill(field.selector, field.value, { timeout });
        }

        // Submit
        await page.click(args.submit_selector, { timeout });

        // Wait for result
        if (args.wait_after_submit) {
          const indicator = args.wait_after_submit;
          if (indicator.startsWith('/') || indicator.startsWith('http')) {
            await page.waitForFunction(
              (pattern: string) => window.location.href.includes(pattern),
              indicator,
              { timeout },
            );
          } else {
            await page.waitForSelector(indicator, { timeout });
          }
        } else {
          await page.waitForTimeout(2000);
        }

        // Optional screenshot — handle directory-only paths gracefully
        let screenshot;
        if (args.screenshot_path) {
          let screenshotPath = args.screenshot_path;
          if (!path.extname(screenshotPath)) {
            screenshotPath = screenshotPath.replace(/\/$/, '') + '/result.png';
          }
          screenshot = await saveScreenshot(page, screenshotPath, args.full_page ?? true);
        }

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              page_id: pageId,
              result_url: page.url(),
              result_title: await page.title(),
              screenshot,
              _handle: buildHandle(pageId),
            }),
          }],
        };
      } catch (err: any) {
        loggerRegistry.error(`[lt-mcp:playwright-cli] submit_form error: ${err.message}`);
        return errorResult(err.message, err.name === 'TimeoutError' ? 'TIMEOUT' : 'SUBMIT_FAILED');
      }
    },
  );
}
