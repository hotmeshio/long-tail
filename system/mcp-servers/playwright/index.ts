import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { loggerRegistry } from '../../../services/logger';

import { registerAtomicTools } from './tools-atomic';
import { registerRunScript } from './tools-run-script';

// Re-export public API consumed by playwright-cli.ts and system/index.ts
export { pages, allocatePageId, ensureBrowser, buildHandle, stopPlaywrightServer } from './browser-lifecycle';
export type { PlaywrightHandle } from './types';

/**
 * Create a Playwright Browser MCP server.
 *
 * Provides 9 tools for browser automation:
 *   navigate, screenshot, click, fill, wait_for, evaluate, run_script, list_pages, close_page
 *
 * All page-scoped tools participate in the _handle convention:
 * - navigate returns a _handle in its result
 * - All other tools accept _handle to locate the page across activities
 * - Fast path: local pages Map (same container)
 * - Slow path: CDP reconnection (different container)
 *
 * `run_script` is the preferred tool for YAML workflows — it executes a
 * multi-step browser script in a single activity, avoiding cross-activity
 * session issues entirely.
 *
 * Returns a fresh McpServer instance each time. The browser is shared
 * and lazy-launched on first tool call.
 */
export async function createPlaywrightServer(options?: {
  name?: string;
}): Promise<McpServer> {
  const name = options?.name || 'long-tail-playwright';
  const instance = new McpServer({ name, version: '1.0.0' });
  registerAtomicTools(instance);
  registerRunScript(instance);
  loggerRegistry.info(`[lt-mcp:playwright] ${name} ready (9 tools registered)`);
  return instance;
}
