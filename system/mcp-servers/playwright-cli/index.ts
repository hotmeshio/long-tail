import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { loggerRegistry } from '../../../services/logger';

import { registerAuthTools } from './tools-auth';
import { registerCaptureTools } from './tools-capture';

export async function createPlaywrightCliServer(options?: {
  name?: string;
}): Promise<McpServer> {
  const name = options?.name || 'long-tail-playwright-cli';
  const instance = new McpServer({ name, version: '1.0.0' });
  registerAuthTools(instance);
  registerCaptureTools(instance);
  loggerRegistry.info(`[lt-mcp:playwright-cli] ${name} ready (5 tools registered)`);
  return instance;
}
