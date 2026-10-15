import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

/** How many tools a server registered, for its ready log line. */
export function registeredToolCount(server: McpServer): number {
  return Object.keys((server as any)._registeredTools ?? {}).length;
}
