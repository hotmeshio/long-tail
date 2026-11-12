import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

/** How many tools a server registered, for its ready log line. */
export function registeredToolCount(server: McpServer): number {
  return Object.keys((server as any)._registeredTools ?? {}).length;
}

/** Remove tools by name; names the server never registered are ignored. */
export function removeTools(server: McpServer, names: readonly string[]): void {
  const tools = (server as any)._registeredTools ?? {};
  for (const name of names) tools[name]?.remove();
}
