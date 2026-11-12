import { loggerRegistry } from '../../../lib/logger';
import type { LTMcpToolManifest } from '../../../types';
import { getClients, getBuiltinFactories, getBuiltinServers } from './connection-lifecycle';

/** The cached instance of a built-in server, created on first use. Null when no factory has that name. */
export async function ensureBuiltinServer(name: string): Promise<any | null> {
  const builtinServers = getBuiltinServers();
  if (!builtinServers.has(name)) {
    const factory = getBuiltinFactories().get(name);
    if (!factory) return null;
    builtinServers.set(name, await factory());
    loggerRegistry.info(`[lt-mcp:builtin] ${name} ready (direct dispatch)`);
  }
  return builtinServers.get(name);
}

/** Names of the tools a built-in server registered. Null when the server is not built in. */
export async function registeredBuiltinToolNames(name: string): Promise<Set<string> | null> {
  const server = await ensureBuiltinServer(name);
  return server ? new Set(Object.keys(server._registeredTools ?? {})) : null;
}

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
  extra?: { authInfo?: { userId: string; role?: string } },
): Promise<{ dispatched: true; result: any } | null> {
  const builtinFactories = getBuiltinFactories();

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

  const server = await ensureBuiltinServer(matchedName);
  const tool = server._registeredTools?.[toolName];
  if (!tool?.handler) return null;

  // Call the handler directly — no transport, no JSON-RPC.
  // Tool handlers return MCP-shaped responses: { content: [{ type: 'text', text: '...' }] }
  // Parse the text content the same way callServerTool does.
  // With `extra`, the handler sees an external caller and acts as them.
  const mcpResponse = extra ? await tool.handler(args, extra) : await tool.handler(args);
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
