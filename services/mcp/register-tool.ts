/**
 * Register a tool on an McpServer, bypassing the SDK's generic type
 * inference that causes TypeScript to OOM during compilation.
 *
 * The MCP SDK's .tool() signatures use deeply nested Zod generics
 * that trigger unbounded type expansion in tsc. Routing through
 * `any` avoids this. Runtime validation is unaffected — the SDK
 * still validates inputs against the Zod schemas at call time.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const registerMcpTool = (server: McpServer, ...args: any[]) =>
  (server as any).tool(...args);
