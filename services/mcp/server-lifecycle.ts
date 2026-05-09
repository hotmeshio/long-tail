import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { loggerRegistry } from '../../lib/logger';
import { registerHumanQueueTools } from './server-tools';

let server: McpServer | null = null;

/**
 * Create the Long Tail Human Queue MCP server.
 *
 * Registers six tools that expose the escalation API:
 * - escalate_to_human -- create a new escalation (fire-and-forget)
 * - check_resolution -- check escalation status
 * - get_available_work -- list available escalations by role
 * - claim_and_resolve -- claim + resolve in one step
 * - resolve_escalation -- resolve an already-claimed escalation
 * - escalate_and_wait -- create escalation and return signal for durable wait
 *
 * The server is created with tools registered but no transport
 * auto-connected. Callers connect a transport programmatically
 * or via the Streamable HTTP endpoint.
 */
export async function createHumanQueueServer(options?: {
  name?: string;
}): Promise<McpServer> {
  if (server) return server;

  const name = options?.name || 'long-tail-human-queue';
  server = new McpServer({ name, version: '1.0.0' });

  registerHumanQueueTools(server);

  loggerRegistry.info(`[lt-mcp:server] ${name} ready (5 tools registered)`);
  return server;
}

/**
 * Get the current MCP server instance.
 */
export function getServer(): McpServer | null {
  return server;
}

/**
 * Stop the MCP server and release resources.
 */
export async function stopServer(): Promise<void> {
  if (server) {
    await server.close();
    server = null;
    loggerRegistry.info('[lt-mcp:server] stopped');
  }
}
