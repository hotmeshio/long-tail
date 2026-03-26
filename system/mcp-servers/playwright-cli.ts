import * as path from 'path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { loggerRegistry } from '../../services/logger';
import { getStorageBackend } from '../../services/storage';
import {
  ensureBrowser,
  pages,
  allocatePageId,
  buildHandle,
} from './playwright';

// ── Schemas ──────────────────────────────────────────────────────────────────

const loginAndCaptureSchema = z.object({
  url: z.string().describe('Login page URL'),
  username_selector: z.string().describe('CSS selector for username input (e.g. #username)'),
  password_selector: z.string().describe('CSS selector for password input (e.g. #password)'),
  username: z.string().describe('Username value'),
  password: z.string().describe('Password value'),
  submit_selector: z.string().describe('CSS selector for submit button (e.g. button[type="submit"])'),
  wait_after_login: z.string().optional()
    .describe('CSS selector or URL substring to wait for after login. For SPAs, use a URL pattern like "/dashboard" to wait until the URL changes.'),
  screenshot_path: z.string().optional()
    .describe('Path to save a post-login screenshot'),
  full_page: z.boolean().optional().describe('Full-page screenshot (default: false)'),
  timeout: z.number().optional().describe('Max wait time in ms (default: 30000)'),
});

const capturePageSchema = z.object({
  url: z.string().describe('URL to navigate to and capture'),
  screenshot_path: z.string().optional()
    .describe('File path to save the screenshot PNG. If omitted, auto-derived from the URL path (e.g., /admin/users → screenshots/admin-users.png).'),
  page_id: z.string().optional().describe('Reuse an existing page to preserve session (e.g., from login_and_capture)'),
  full_page: z.boolean().optional().describe('Capture full scrollable page (default: true)'),
  wait_for_selector: z.string().optional()
    .describe('CSS selector to wait for before capturing (ensures content is loaded)'),
  wait_ms: z.number().optional()
    .describe('Fixed delay in ms after page load before capturing (default: 2000). Use when no specific selector to wait for.'),
  wait_until: z.enum(['load', 'domcontentloaded', 'networkidle']).optional()
    .describe('Navigation wait strategy (default: load)'),
  timeout: z.number().optional().describe('Max navigation timeout in ms (default: 30000)'),
});

const captureAuthenticatedPagesSchema = z.object({
  login: z.object({
    url: z.string(),
    username_selector: z.string(),
    password_selector: z.string(),
    username: z.string(),
    password: z.string(),
    submit_selector: z.string(),
    wait_after_login: z.string().optional(),
    timeout: z.number().optional(),
  }).describe('Login parameters — same shape as login_and_capture'),
  pages: z.array(z.object({
    url: z.string().describe('URL to navigate to'),
    screenshot_path: z.string().describe('Path to save screenshot'),
    wait_for_selector: z.string().optional(),
    wait_ms: z.number().optional(),
    full_page: z.boolean().optional(),
  })).describe('Pages to capture after login — session is shared across all'),
});

const extractContentSchema = z.object({
  url: z.string().optional().describe('URL to navigate to. Omit to extract from an existing page (requires page_id).'),
  page_id: z.string().optional().describe('Reuse an existing page (e.g., from login_and_capture). Skips navigation if url is also omitted.'),
  selector: z.string().optional().describe('CSS selector to extract text from'),
  script: z.string().optional().describe('Custom JavaScript to evaluate and return data'),
  extract_links: z.boolean().optional().describe('Also extract all links from the page'),
  extract_metadata: z.boolean().optional().describe('Also extract meta title, description, and OG tags'),
  wait_for_selector: z.string().optional().describe('Wait for this selector before extracting'),
  wait_ms: z.number().optional().describe('Fixed delay before extraction (default: 1000)'),
  timeout: z.number().optional(),
});

const submitFormSchema = z.object({
  url: z.string().describe('Form page URL'),
  fields: z.array(z.object({
    selector: z.string().describe('CSS selector for the input'),
    value: z.string().describe('Value to fill'),
  })).describe('Fields to fill before submitting'),
  submit_selector: z.string().describe('CSS selector for the submit button'),
  wait_after_submit: z.string().optional()
    .describe('CSS selector or URL pattern to wait for after submit'),
  screenshot_path: z.string().optional().describe('Path to save post-submit screenshot'),
  full_page: z.boolean().optional(),
  timeout: z.number().optional(),
});

// ── Helpers ──────────────────────────────────────────────────────────────────

async function saveScreenshot(page: import('playwright').Page, filePath: string, fullPage: boolean) {
  const backend = getStorageBackend();
  const localPath = await backend.getLocalPath(filePath);
  await page.screenshot({ path: localPath, fullPage });
  const { size } = await backend.commitLocalPath(filePath, localPath);
  loggerRegistry.info(`[lt-mcp:playwright-cli] screenshot: ${filePath} (${size} bytes)`);
  return { path: filePath, size_bytes: size };
}

function errorResult(message: string, code: string, details?: Record<string, unknown>) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify({ error: message, code, ...details }) }],
    isError: true,
  };
}

// ── Tool registration ────────────────────────────────────────────────────────

function registerTools(srv: McpServer): void {

  // ── login_and_capture ─────────────────────────────────────
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

  // ── capture_page ──────────────────────────────────────────
  (srv as any).registerTool(
    'capture_page',
    {
      title: 'Capture Page',
      description:
        'Navigate to a URL and capture a screenshot in one call. ' +
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
        const screenshotPath = args.screenshot_path || (() => {
          try {
            const urlPath = new URL(args.url).pathname;
            const slug = urlPath === '/' ? 'home' : urlPath.replace(/^\/+|\/+$/g, '').replace(/\//g, '-');
            return `screenshots/${slug || 'page'}.png`;
          } catch {
            return `screenshots/capture-${Date.now()}.png`;
          }
        })();

        const screenshot = await saveScreenshot(page, screenshotPath, args.full_page ?? true);

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              page_id: pageId,
              url: page.url(),
              title: await page.title(),
              ...screenshot,
              _handle: buildHandle(pageId),
            }),
          }],
        };
      } catch (err: any) {
        return errorResult(err.message, err.name === 'TimeoutError' ? 'TIMEOUT' : 'CAPTURE_FAILED');
      }
    },
  );

  // ── capture_authenticated_pages ───────────────────────────
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

  // ── extract_content ───────────────────────────────────────
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

  // ── submit_form ───────────────────────────────────────────
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

// ── Factory ──────────────────────────────────────────────────────────────────

export async function createPlaywrightCliServer(options?: {
  name?: string;
}): Promise<McpServer> {
  const name = options?.name || 'long-tail-playwright-cli';
  const instance = new McpServer({ name, version: '1.0.0' });
  registerTools(instance);
  loggerRegistry.info(`[lt-mcp:playwright-cli] ${name} ready (5 tools registered)`);
  return instance;
}
