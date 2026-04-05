import { z } from 'zod';

// Zod schemas extracted to break TS2589 deep-instantiation cycles.

export const navigateSchema = z.object({
  url: z.string().describe('URL to navigate to'),
  wait_until: z.enum(['load', 'domcontentloaded', 'networkidle']).optional()
    .describe('When to consider navigation complete (default: load)'),
});

export const screenshotSchema = z.object({
  page_id: z.string().optional()
    .describe('Page to screenshot (default: most recent)'),
  path: z.string()
    .describe('File path to save the screenshot PNG'),
  full_page: z.boolean().optional()
    .describe('Capture the full scrollable page (default: false)'),
  selector: z.string().optional()
    .describe('CSS selector to screenshot a specific element'),
});

export const clickSchema = z.object({
  page_id: z.string().optional()
    .describe('Page to act on (default: most recent)'),
  selector: z.string().describe('CSS selector of the element to click'),
});

export const fillSchema = z.object({
  page_id: z.string().optional()
    .describe('Page to act on (default: most recent)'),
  selector: z.string().describe('CSS selector of the input element'),
  value: z.string().describe('Value to type into the input'),
});

export const waitForSchema = z.object({
  page_id: z.string().optional()
    .describe('Page to act on (default: most recent)'),
  selector: z.string().describe('CSS selector to wait for'),
  timeout: z.number().optional()
    .describe('Max wait time in ms (default: 10000)'),
});

export const evaluateSchema = z.object({
  page_id: z.string().optional()
    .describe('Page to act on (default: most recent)'),
  script: z.string()
    .describe('JavaScript expression to evaluate in the page context'),
});

export const listPagesSchema = z.object({});

export const closePageSchema = z.object({
  page_id: z.string().describe('Page ID to close'),
});
