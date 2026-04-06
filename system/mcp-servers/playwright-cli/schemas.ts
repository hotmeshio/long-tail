import { z } from 'zod';

export const loginAndCaptureSchema = z.object({
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

export const capturePageSchema = z.object({
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

export const captureAuthenticatedPagesSchema = z.object({
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

export const extractContentSchema = z.object({
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

export const submitFormSchema = z.object({
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
