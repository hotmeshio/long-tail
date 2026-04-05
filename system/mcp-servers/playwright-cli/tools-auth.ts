import * as path from 'path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { loggerRegistry } from '../../../services/logger';
import {
  ensureBrowser,
  pages,
  allocatePageId,
  buildHandle,
} from '../playwright';

import { loginAndCaptureSchema, captureAuthenticatedPagesSchema } from './schemas';
import { saveScreenshot, errorResult } from './helpers';

export function registerAuthTools(srv: McpServer): void {

  // login_and_capture
  (srv as any).registerTool(
    'login_and_capture',
    {
      title: 'Login & Capture',
      description:
        'Log into a website and optionally capture a screenshot of the authenticated page. ' +
        'Handles navigation, credential entry, form submission, and post-login waiting in one call. ' +
        'Returns a page handle for use with other tools. ' +
        'PREFERRED over separate navigate/fill/click calls for login flows. ' +
        'Common selectors: #username / #password / button[type="submit"]. ' +
        'If unsure about selectors, use extract_content first to discover the page structure.',
      inputSchema: loginAndCaptureSchema,
    },
    async (args: z.infer<typeof loginAndCaptureSchema>) => {
      try {
        const b = await ensureBrowser();
        const page = await b.newPage();
        const pageId = allocatePageId();
        pages.set(pageId, page);

        const timeout = args.timeout ?? 30_000;

        // Navigate to login page
        await page.goto(args.url, { waitUntil: 'load', timeout });

        // Fill credentials and submit
        await page.fill(args.username_selector, args.username, { timeout });
        await page.fill(args.password_selector, args.password, { timeout });
        await page.click(args.submit_selector, { timeout });

        // Wait for post-login indicator
        if (args.wait_after_login) {
          const indicator = args.wait_after_login;
          if (indicator.startsWith('/') || indicator.startsWith('http')) {
            // URL pattern — wait until URL contains this string
            await page.waitForFunction(
              (pattern: string) => window.location.href.includes(pattern),
              indicator.startsWith('http') ? indicator : indicator,
              { timeout },
            );
            // Extra settle time for SPA data loading
            await page.waitForTimeout(2000);
          } else {
            // CSS selector
            await page.waitForSelector(indicator, { timeout });
          }
        } else {
          // Default: wait for URL to change from login page
          const loginUrl = args.url;
          await page.waitForFunction(
            (url: string) => !window.location.href.includes(url),
            loginUrl.replace(/https?:\/\/[^/]+/, ''),
            { timeout },
          );
          await page.waitForTimeout(2000);
        }

        // Optional screenshot — handle directory-only paths gracefully
        let screenshot;
        if (args.screenshot_path) {
          let screenshotPath = args.screenshot_path;
          if (!path.extname(screenshotPath)) {
            screenshotPath = screenshotPath.replace(/\/$/, '') + '/home.png';
          }
          screenshot = await saveScreenshot(page, screenshotPath, args.full_page ?? true);
        }

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              page_id: pageId,
              url: page.url(),
              title: await page.title(),
              logged_in: true,
              screenshot,
              _handle: buildHandle(pageId),
            }),
          }],
        };
      } catch (err: any) {
        loggerRegistry.error(`[lt-mcp:playwright-cli] login_and_capture error: ${err.message}`);
        return errorResult(err.message, err.name === 'TimeoutError' ? 'TIMEOUT' : 'LOGIN_FAILED');
      }
    },
  );

  // capture_authenticated_pages
  (srv as any).registerTool(
    'capture_authenticated_pages',
    {
      title: 'Capture Authenticated Pages',
      description:
        'Log in once, then navigate to multiple URLs capturing a screenshot of each. ' +
        'Reuses the same browser page so the authenticated session persists across all captures. ' +
        'PREFERRED for "login then screenshot all pages" tasks — handles the entire flow in one call.',
      inputSchema: captureAuthenticatedPagesSchema,
    },
    async (args: z.infer<typeof captureAuthenticatedPagesSchema>) => {
      try {
        const login = args.login;
        const b = await ensureBrowser();
        const page = await b.newPage();
        const pageId = allocatePageId();
        pages.set(pageId, page);

        const timeout = login.timeout ?? 30_000;

        // Login sequence
        await page.goto(login.url, { waitUntil: 'load', timeout });
        await page.fill(login.username_selector, login.username, { timeout });
        await page.fill(login.password_selector, login.password, { timeout });
        await page.click(login.submit_selector, { timeout });

        if (login.wait_after_login) {
          const indicator = login.wait_after_login;
          if (indicator.startsWith('/') || indicator.startsWith('http')) {
            await page.waitForFunction(
              (pattern: string) => window.location.href.includes(pattern),
              indicator,
              { timeout },
            );
            await page.waitForTimeout(2000);
          } else {
            await page.waitForSelector(indicator, { timeout });
          }
        } else {
          const loginPath = login.url.replace(/https?:\/\/[^/]+/, '');
          await page.waitForFunction(
            (path: string) => !window.location.href.includes(path),
            loginPath,
            { timeout },
          );
          await page.waitForTimeout(2000);
        }

        // Capture each page (same browser page = same session)
        const captures: Array<{ url: string; path: string; size_bytes: number; title: string }> = [];

        for (const target of args.pages) {
          await page.goto(target.url, { waitUntil: 'load', timeout: 30_000 });

          if (target.wait_for_selector) {
            await page.waitForSelector(target.wait_for_selector, { timeout: 10_000 });
          } else {
            await page.waitForTimeout(target.wait_ms ?? 3000);
          }

          const shot = await saveScreenshot(page, target.screenshot_path, target.full_page ?? true);
          captures.push({
            url: page.url(),
            title: await page.title(),
            ...shot,
          });
        }

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              page_id: pageId,
              login_url: login.url,
              captures,
              total: captures.length,
              _handle: buildHandle(pageId),
            }),
          }],
        };
      } catch (err: any) {
        return errorResult(err.message, err.name === 'TimeoutError' ? 'TIMEOUT' : 'CAPTURE_FAILED');
      }
    },
  );
}
