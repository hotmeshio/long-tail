import { loggerRegistry } from '../../../lib/logger';
import { MCP_TOOL_TIMEOUT_MS } from '../../../modules/defaults';
import { getToolContext } from '../../iam/context';
import * as mcpDbService from '../db';
import type { LTMcpToolManifest } from '../../../types';

import { resolveClient, listServerTools } from './connection';

/**
 * Derive auth context from the ambient ToolContext (AsyncLocalStorage).
 * Returns undefined when no ToolContext is active (e.g., direct CLI calls).
 */
function deriveAuthFromToolContext(): { userId?: string; delegationToken?: string } | undefined {
  const ctx = getToolContext();
  if (!ctx?.principal.id) return undefined;
  return {
    userId: ctx.principal.id,
    delegationToken: ctx.credentials.delegationToken,
  };
}

/**
 * Call a tool on a connected server.
 * Resolves the server by ID or name, auto-connecting built-in servers.
 */
export async function callServerTool(
  serverId: string,
  toolName: string,
  args: Record<string, any>,
  authContext?: { userId?: string; delegationToken?: string },
): Promise<any> {
  const client = await resolveClient(serverId);
  if (!client) {
    throw new Error(`MCP server ${serverId} is not connected`);
  }
  // Resolve auth: explicit authContext > ambient ToolContext > none
  const resolvedAuth = authContext ?? deriveAuthFromToolContext();
  // Inject auth context as a hidden _auth argument when available
  const toolArgs = resolvedAuth?.userId || resolvedAuth?.delegationToken
    ? { ...args, _auth: { userId: resolvedAuth.userId, token: resolvedAuth.delegationToken } }
    : args;
  // Audit: log tool invocation with principal identity
  const ctx = getToolContext();
  if (ctx?.principal.id) {
    loggerRegistry.debug(
      `[lt-mcp:audit] ${toolName} on ${serverId} by ${ctx.principal.type}:${ctx.principal.id}`,
    );
  }

  const result = await client.callTool(
    { name: toolName, arguments: toolArgs },
    undefined,
    { timeout: MCP_TOOL_TIMEOUT_MS },
  );
  // Extract text content from MCP response
  if (Array.isArray(result.content)) {
    const textContent = result.content.find((c: any) => c.type === 'text');
    if (textContent && 'text' in textContent) {
      try {
        return JSON.parse(textContent.text);
      } catch {
        return textContent.text;
      }
    }
  }
  return result.content;
}

/**
 * Return a map of tool functions suitable for proxyActivities().
 *
 * Each tool is wrapped as:
 *   `mcp_{serverName}_{toolName}(args) => Promise<any>`
 *
 * Usage in a workflow:
 * ```typescript
 * const tools = await mcpClient.toolActivities(serverId);
 * const proxied = Durable.workflow.proxyActivities({ activities: tools });
 * const result = await proxied.mcp_myserver_search({ query: 'hello' });
 * ```
 */
export async function toolActivities(
  serverId: string,
): Promise<Record<string, (args: Record<string, any>) => Promise<any>>> {
  const server = await mcpDbService.getMcpServer(serverId);
  if (!server) throw new Error(`MCP server ${serverId} not found`);

  const tools = server.tool_manifest || await listServerTools(serverId);
  const activities: Record<string, (args: Record<string, any>) => Promise<any>> = {};

  const safeName = server.name.replace(/[^a-zA-Z0-9]/g, '_');
  for (const tool of tools) {
    const activityName = `mcp_${safeName}_${tool.name.replace(/[^a-zA-Z0-9]/g, '_')}`;
    activities[activityName] = async (args: Record<string, any>) => {
      return callServerTool(serverId, tool.name, args);
    };
  }

  return activities;
}
