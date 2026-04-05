import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { loggerRegistry } from '../../logger';

import { registerDbTools } from './tools';

let server: McpServer | null = null;

/**
 * Create the Long Tail DB Query MCP server.
 *
 * Provides read-only query tools against the lt_* tables:
 * - find_tasks -- search tasks by status, workflow type, or origin
 * - find_escalations -- search escalations by status, role, type
 * - get_process_summary -- aggregate process view grouped by origin_id
 * - get_escalation_stats -- real-time escalation statistics
 * - get_workflow_types -- list registered workflow configurations
 * - get_system_health -- overall system health snapshot
 */
export async function createDbServer(options?: {
  name?: string;
  /** When true, skip the singleton cache and create a dedicated instance. */
  fresh?: boolean;
}): Promise<McpServer> {
  if (server && !options?.fresh) return server;

  const name = options?.name || 'long-tail-db-query';
  const instance = new McpServer({ name, version: '1.0.0' });

  // Only cache as the singleton when not a fresh (dedicated) instance
  if (!options?.fresh) {
    server = instance;
  }

  registerDbTools(instance);

  loggerRegistry.info(`[lt-mcp:db-server] ${name} ready (6 tools registered)`);
  return instance;
}

/**
 * Get the current DB MCP server instance.
 */
export function getDbServer(): McpServer | null {
  return server;
}

/**
 * Stop the DB MCP server and release resources.
 */
export async function stopDbServer(): Promise<void> {
  if (server) {
    await server.close();
    server = null;
    loggerRegistry.info('[lt-mcp:db-server] stopped');
  }
}
