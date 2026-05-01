import { loggerRegistry } from '../../../lib/logger';
import { MCP_TOOL_TIMEOUT_MS } from '../../../modules/defaults';
import { getToolContext } from '../../iam/context';
import * as mcpDbService from '../db';
import type { LTMcpToolManifest } from '../../../types';

import { resolveClient, listServerTools, dispatchBuiltinTool } from './connection';

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
  loggerRegistry.debug(`[lt-mcp:call] entering ${serverId}/${toolName} argKeys=[${Object.keys(args).join(',')}]`);

  // Resolve auth context before dispatch — both paths need it
  const resolvedAuth = authContext ?? deriveAuthFromToolContext();
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

  // Direct dispatch for built-in servers — bypasses MCP Client/Transport.
  // Each built-in server is a cached singleton; tool handlers are called
  // as plain functions. No transport contention under concurrent load.
  const builtin = await dispatchBuiltinTool(serverId, toolName, toolArgs);
  if (builtin) {
    loggerRegistry.debug(`[lt-mcp:call] leaving ${serverId}/${toolName} (builtin) resultKeys=[${typeof builtin.result === 'object' && builtin.result ? Object.keys(builtin.result).join(',') : 'raw'}]`);
    return builtin.result;
  }

  // External servers — use MCP Client/Transport with timeout guard
  const client = await resolveClient(serverId);
  if (!client) {
    throw new Error(`MCP server ${serverId} is not connected`);
  }

  // Guard against hung transports: the MCP SDK timeout relies on the transport
  // to respond, which fails when InMemoryTransport is saturated under concurrency.
  // Promise.race ensures we throw on timeout regardless of transport state.
  const callPromise = client.callTool(
    { name: toolName, arguments: toolArgs },
    undefined,
    { timeout: MCP_TOOL_TIMEOUT_MS },
  );
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(
      () => reject(new Error(`MCP tool ${serverId}/${toolName} timed out after ${MCP_TOOL_TIMEOUT_MS}ms`)),
      MCP_TOOL_TIMEOUT_MS,
    ),
  );
  const result = await Promise.race([callPromise, timeoutPromise]);
  // Extract text content from MCP response
  if (Array.isArray(result.content)) {
    const textContent = result.content.find((c: any) => c.type === 'text');
    if (textContent && 'text' in textContent) {
      try {
        const parsed = JSON.parse(textContent.text);
        const isError = result.isError || ('error' in parsed);
        loggerRegistry.debug(`[lt-mcp:call] leaving ${serverId}/${toolName} ok=${!isError} resultKeys=[${Object.keys(parsed).join(',')}]`);
        return parsed;
      } catch {
        // Non-JSON text — wrap as error object when isError flag is set
        // to prevent raw strings from being spread as character indices downstream.
        if (result.isError) {
          loggerRegistry.warn(`[lt-mcp:call] leaving ${serverId}/${toolName} error: ${textContent.text.slice(0, 200)}`);
          return { error: textContent.text };
        }
        loggerRegistry.debug(`[lt-mcp:call] leaving ${serverId}/${toolName} raw text (${textContent.text.length} chars)`);
        return textContent.text;
      }
    }
  }
  loggerRegistry.debug(`[lt-mcp:call] leaving ${serverId}/${toolName} non-text content (${Array.isArray(result.content) ? result.content.length : 0} blocks)`);
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
