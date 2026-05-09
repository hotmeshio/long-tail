import { loggerRegistry } from '../../../lib/logger';
import type { LTMcpToolManifest } from '../../../types';
import { getClients, getBuiltinFactories, getBuiltinServers } from './connection-lifecycle';

/**
 * Dispatch a tool call directly to a built-in server's handler,
 * bypassing MCP Client/Transport entirely. Returns null if the server
 * or tool is not a built-in — caller should fall through to MCP transport.
 *
 * Each built-in server is lazily instantiated once and cached. Tool handlers
 * are called via server._registeredTools[toolName].handler(args). This
 * eliminates the InMemoryTransport bottleneck under concurrent load.
 */
export async function dispatchBuiltinTool(
  serverId: string,
  toolName: string,
  args: Record<string, any>,
): Promise<{ dispatched: true; result: any } | null> {
  const builtinFactories = getBuiltinFactories();
  const builtinServers = getBuiltinServers();

  // Normalize and match against builtin factories
  const norm = (s: string) => s.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
  const normId = norm(serverId);
  let matchedName: string | null = null;
  for (const [name] of builtinFactories) {
    const normName = norm(name);
    if (normName === normId || normName.includes(normId) || normId.includes(normName)) {
      matchedName = name;
      break;
    }
  }
  if (!matchedName) return null;

  // Lazily create and cache the server instance
  if (!builtinServers.has(matchedName)) {
    const factory = builtinFactories.get(matchedName)!;
    const server = await factory();
    builtinServers.set(matchedName, server);
    loggerRegistry.info(`[lt-mcp:builtin] ${matchedName} ready (direct dispatch)`);
  }

  const server = builtinServers.get(matchedName)!;
  const tool = server._registeredTools?.[toolName];
  if (!tool?.handler) return null;

  // Call the handler directly — no transport, no JSON-RPC.
  // Tool handlers return MCP-shaped responses: { content: [{ type: 'text', text: '...' }] }
  // Parse the text content the same way callServerTool does.
  const mcpResponse = await tool.handler(args);
  let parsed: any = mcpResponse;

  if (mcpResponse && Array.isArray(mcpResponse.content)) {
    const textContent = mcpResponse.content.find((c: any) => c.type === 'text');
    if (textContent && 'text' in textContent) {
      try {
        parsed = JSON.parse(textContent.text);
      } catch {
        parsed = mcpResponse.isError ? { error: textContent.text } : textContent.text;
      }
    }
  }

  const isError = parsed && typeof parsed === 'object' && 'error' in parsed;
  loggerRegistry.debug(`[lt-mcp:builtin] ${matchedName}/${toolName} ok=${!isError} resultKeys=[${typeof parsed === 'object' && parsed ? Object.keys(parsed).join(',') : 'raw'}]`);
  return { dispatched: true, result: parsed };
}

/**
 * List tools from a connected server.
 */
export async function listServerTools(serverId: string): Promise<LTMcpToolManifest[]> {
  const clients = getClients();
  const client = clients.get(serverId);
  if (!client) {
    throw new Error(`MCP server ${serverId} is not connected`);
  }
  const { tools } = await client.listTools();
  return tools.map((t: any) => ({
    name: t.name,
    description: t.description || '',
    inputSchema: t.inputSchema || {},
  }));
}
