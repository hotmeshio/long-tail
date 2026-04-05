import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { z } from 'zod';
import type { Page } from 'playwright';

import { loggerRegistry } from '../../../services/logger';
import { getStorageBackend } from '../../../services/storage';

import { SESSION_NOT_FOUND, RESOURCE_NOT_FOUND } from './types';
import { pages, ensureBrowser, resolvePage, buildHandle, allocatePageId } from './browser-lifecycle';
import { runScriptSchema } from './schemas';

export function registerRunScript(srv: McpServer): void {
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

        // Navigate: reuse existing page to preserve session (cookies, localStorage, SPA state).
        // Only create a new page on the first navigate.
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
          if (!page) {
            const b = await ensureBrowser();
            page = await b.newPage();
            pageId = allocatePageId();
            pages.set(pageId, page);
          }
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
            const ssBackend = getStorageBackend();
            const ssLocalPath = await ssBackend.getLocalPath(step.path);
            if (step.selector) {
              const el = await page.$(step.selector);
              if (!el) {
                stepResults.push({ step: i, action: 'screenshot', result: { error: `Element not found: ${step.selector}`, code: RESOURCE_NOT_FOUND } });
                continue;
              }
              await el.screenshot({ path: ssLocalPath });
            } else {
              await page.screenshot({ path: ssLocalPath, fullPage: step.full_page ?? false });
            }
            const { size: ssSize } = await ssBackend.commitLocalPath(step.path, ssLocalPath);
            loggerRegistry.info(`[lt-mcp:playwright] screenshot saved: ${step.path} (${ssSize} bytes)`);
            stepResults.push({ step: i, action: 'screenshot', result: { path: step.path, size_bytes: ssSize, url: page.url() } });
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
          case 'wait_for_url': {
            if (!step.url) {
              return {
                content: [{ type: 'text' as const, text: JSON.stringify({ error: `Step ${i}: wait_for_url requires url`, code: RESOURCE_NOT_FOUND }) }],
                isError: true,
              };
            }
            const urlTimeout = step.timeout ?? 10_000;
            if (step.not) {
              // Wait until URL does NOT contain the pattern
              await page.waitForFunction(
                (pattern: string) => !window.location.href.includes(pattern),
                step.url,
                { timeout: urlTimeout },
              );
            } else {
              // Wait until URL contains the pattern
              await page.waitForURL(`**${step.url}**`, { timeout: urlTimeout });
            }
            stepResults.push({ step: i, action: 'wait_for_url', result: { url: page.url(), matched: !step.not } });
            break;
          }
          case 'wait': {
            const ms = step.timeout ?? 2000;
            await page.waitForTimeout(ms);
            stepResults.push({ step: i, action: 'wait', result: { waited_ms: ms } });
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
}
