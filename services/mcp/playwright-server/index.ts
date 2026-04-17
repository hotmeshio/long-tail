import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { loggerRegistry } from '../../../lib/logger';

import { registerTools } from './tools';

export { stopPlaywrightServer } from './lifecycle';

/**
 * Create a Playwright Browser MCP server.
 *
 * Provides 8 tools for browser automation:
 *   navigate, screenshot, click, fill, wait_for, evaluate, list_pages, close_page
 *
 * Returns a fresh McpServer instance each time. The browser is shared
 * and lazy-launched on first tool call.
 */
export async function createPlaywrightServer(options?: {
  name?: string;
}): Promise<McpServer> {
  const name = options?.name || 'long-tail-playwright';
  const instance = new McpServer({ name, version: '1.0.0' });
  registerTools(instance);
  loggerRegistry.info(`[lt-mcp:playwright] ${name} ready (8 tools registered)`);
  return instance;
}
