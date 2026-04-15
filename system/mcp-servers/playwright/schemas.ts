import { z } from 'zod';

// _handle is accepted by all page-scoped tools. The YAML generator auto-threads
// it between activities. Agentic (LLM) callers can ignore it — page_id works.
export const handleProp = z.object({
  type: z.literal('playwright_page'),
  cdp_endpoint: z.string().optional(),
  page_id: z.string(),
}).optional().describe('Resource handle from a prior Playwright tool call. Enables cross-activity page access.');

export const navigateSchema = z.object({
  _handle: handleProp,
  page_id: z.string().optional()
    .describe('Reuse an existing page to preserve session (cookies, auth). If omitted, opens a new page.'),
  url: z.string().describe('URL to navigate to'),
  wait_until: z.enum(['load', 'domcontentloaded', 'networkidle']).optional()
    .describe('When to consider navigation complete (default: load)'),
});

export const screenshotSchema = z.object({
  _handle: handleProp,
  url: z.string().optional()
    .describe('URL to navigate to before screenshotting. When used WITH page_id, navigates the existing page (preserving session). Without page_id, opens a new page.'),
  wait_until: z.enum(['load', 'domcontentloaded', 'networkidle']).optional()
    .describe('When to consider navigation complete — only used with url (default: load)'),
  page_id: z.string().optional()
    .describe('Page to screenshot (default: most recent). When combined with url, navigates that page first (preserving session/cookies).'),
  path: z.string()
    .describe('File path to save the screenshot PNG'),
  full_page: z.boolean().optional()
    .describe('Capture the full scrollable page (default: false)'),
  selector: z.string().optional()
    .describe('CSS selector to screenshot a specific element'),
  describe: z.boolean().optional()
    .describe('When true, automatically analyze the screenshot using a vision LLM and return a description alongside metadata. Use this when you need to understand the page content.'),
});

export const clickSchema = z.object({
  _handle: handleProp,
  page_id: z.string().optional()
    .describe('Page to act on (default: most recent)'),
  selector: z.string().describe('CSS selector of the element to click'),
});

export const fillSchema = z.object({
  _handle: handleProp,
  page_id: z.string().optional()
    .describe('Page to act on (default: most recent)'),
  selector: z.string().describe('CSS selector of the input element'),
  value: z.string().describe('Value to type into the input'),
});

export const waitForSchema = z.object({
  _handle: handleProp,
  page_id: z.string().optional()
    .describe('Page to act on (default: most recent)'),
  selector: z.string().describe('CSS selector to wait for'),
  timeout: z.number().optional()
    .describe('Max wait time in ms (default: 10000)'),
});

export const evaluateSchema = z.object({
  _handle: handleProp,
  page_id: z.string().optional()
    .describe('Page to act on (default: most recent)'),
  script: z.string()
    .describe('JavaScript expression to evaluate in the page context'),
});

export const listPagesSchema = z.object({});

export const closePageSchema = z.object({
  _handle: handleProp,
  page_id: z.string().describe('Page ID to close'),
});

export const runScriptStepSchema = z.object({
  action: z.enum(['navigate', 'screenshot', 'click', 'fill', 'wait_for', 'wait_for_url', 'wait', 'evaluate'])
    .describe('Browser action to perform'),
  url: z.string().optional().describe('URL for navigate action, or URL pattern for wait_for_url'),
  wait_until: z.enum(['load', 'domcontentloaded', 'networkidle']).optional()
    .describe('Navigation wait strategy (default: load)'),
  path: z.string().optional().describe('File path for screenshot action'),
  full_page: z.boolean().optional().describe('Full-page screenshot (default: false)'),
  selector: z.string().optional().describe('CSS selector for click/fill/wait_for/screenshot'),
  value: z.string().optional().describe('Value for fill action'),
  script: z.string().optional().describe('JavaScript for evaluate action'),
  timeout: z.number().optional().describe('Timeout in ms for wait_for/wait_for_url/wait actions'),
  not: z.boolean().optional().describe('For wait_for_url: wait until URL does NOT match (default: false)'),
  describe: z.boolean().optional().describe('For screenshot: auto-analyze via vision LLM and include description in result'),
});

export const runScriptSchema = z.object({
  _handle: handleProp,
  steps: z.array(runScriptStepSchema)
    .describe('Ordered list of browser actions to execute sequentially on a single page. ' +
      'Preferred for deterministic YAML workflows — encapsulates an entire browser interaction in one activity.'),
});
