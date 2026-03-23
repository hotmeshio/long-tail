import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { loggerRegistry } from '../logger';
import * as mcpDbService from './db';
import type { LTMcpServerRecord, LTMcpToolManifest } from '../../types';

/** In-memory map of server ID/name to active MCP client */
const clients = new Map<string, Client>();

/**
 * Built-in server factories — keyed by server name.
 * These are in-process MCP servers that connect via InMemoryTransport
 * rather than external stdio/SSE connections.
 */
const builtinFactories = new Map<string, () => Promise<any>>();

/**
 * Register a built-in server factory so it can be auto-connected
 * when callServerTool is invoked with its name.
 */
export function registerBuiltinServer(
  name: string,
  factory: () => Promise<any>,
): void {
  builtinFactories.set(name, factory);
}

/**
 * Connect to a registered MCP server.
 * Creates the appropriate transport based on transport_type,
 * connects, and caches tool manifest in DB.
 */
export async function connectToServer(server: LTMcpServerRecord): Promise<Client> {
  if (clients.has(server.id)) {
    return clients.get(server.id)!;
  }

  // Built-in servers use InMemoryTransport via their registered factory
  if ((server.transport_config as any)?.builtin) {
    // Find matching factory by server name
    for (const [name, factory] of builtinFactories) {
      if (server.name === name || name.includes(server.name) || server.name.includes(name)) {
        // Reuse existing client if factory was already connected
        if (clients.has(name)) {
          clients.set(server.id, clients.get(name)!);
          await mcpDbService.updateMcpServerStatus(server.id, 'connected');
          return clients.get(name)!;
        }

        const srv = await factory();
        const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
        await srv.connect(serverTransport);

        const client = new Client({ name: `builtin-${name}`, version: '1.0.0' });
        await client.connect(clientTransport);
        clients.set(name, client);
        clients.set(server.id, client);

        // Cache the tool manifest
        const { tools } = await client.listTools();
        const manifest: LTMcpToolManifest[] = tools.map((t: any) => ({
          name: t.name,
          description: t.description || '',
          inputSchema: t.inputSchema || {},
        }));

        await mcpDbService.updateMcpServerStatus(server.id, 'connected', manifest);
        loggerRegistry.info(`[lt-mcp:client] connected builtin server: ${name} (${manifest.length} tools)`);
        return client;
      }
    }
    throw new Error(`No builtin factory registered for server: ${server.name}`);
  }

  const client = new Client({ name: 'long-tail', version: '1.0.0' });

  let transport: any;
  if (server.transport_type === 'stdio') {
    transport = new StdioClientTransport({
      command: server.transport_config.command!,
      args: server.transport_config.args || [],
      env: server.transport_config.env,
    });
  } else {
    transport = new SSEClientTransport(new URL(server.transport_config.url!));
  }

  await client.connect(transport);
  clients.set(server.id, client);

  // Cache the tool manifest
  const { tools } = await client.listTools();
  const manifest: LTMcpToolManifest[] = tools.map((t: any) => ({
    name: t.name,
    description: t.description || '',
    inputSchema: t.inputSchema || {},
  }));

  await mcpDbService.updateMcpServerStatus(server.id, 'connected', manifest);
  loggerRegistry.info(`[lt-mcp:client] connected to ${server.name} (${manifest.length} tools)`);

  return client;
}

/**
 * Disconnect from a specific server.
 */
export async function disconnectFromServer(serverId: string): Promise<void> {
  const client = clients.get(serverId);
  if (client) {
    await client.close();
    clients.delete(serverId);
    await mcpDbService.updateMcpServerStatus(serverId, 'disconnected');
    loggerRegistry.info(`[lt-mcp:client] disconnected from ${serverId}`);
  }
}

/**
 * List tools from a connected server.
 */
export async function listServerTools(serverId: string): Promise<LTMcpToolManifest[]> {
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

/**
 * Resolve a server by ID or name, auto-connecting built-in servers if needed.
 * Returns the client or null if not found.
 *
 * Built-in servers are connected once under their canonical factory name.
 * Alias lookups (e.g. 'vision' matching 'long-tail-document-vision') reuse
 * the same client instance to avoid double-connecting the singleton server.
 */
async function resolveClient(serverId: string): Promise<Client | null> {
  // 1. Direct lookup (by UUID or name)
  if (clients.has(serverId)) return clients.get(serverId)!;

  // 2. Check built-in server factories — exact match first, then fuzzy
  let matchedName: string | null = null;
  if (builtinFactories.has(serverId)) {
    matchedName = serverId;
  } else {
    for (const [name] of builtinFactories) {
      if (name.includes(serverId) || serverId.includes(name)) {
        matchedName = name;
        break;
      }
    }
  }

  if (matchedName) {
    const factory = builtinFactories.get(matchedName)!;
    // Check if we already connected this factory under its canonical name
    if (clients.has(matchedName)) {
      // Alias the serverId to the existing client so future lookups are instant
      clients.set(serverId, clients.get(matchedName)!);
      return clients.get(matchedName)!;
    }

    const server = await factory();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);

    const client = new Client({ name: `builtin-${matchedName}`, version: '1.0.0' });
    await client.connect(clientTransport);
    // Cache under both the canonical name and the requested serverId
    clients.set(matchedName, client);
    if (serverId !== matchedName) clients.set(serverId, client);
    loggerRegistry.info(`[lt-mcp:client] auto-connected built-in server: ${matchedName} (as '${serverId}')`);
    return client;
  }

  // 3. Look up in DB by ID or name, then try to match a built-in factory
  try {
    const dbServer =
      (await mcpDbService.getMcpServer(serverId)) ||
      (await mcpDbService.getMcpServerByName(serverId));

    if (dbServer) {
      // Already connected under its DB id?
      if (clients.has(dbServer.id)) {
        clients.set(serverId, clients.get(dbServer.id)!);
        return clients.get(dbServer.id)!;
      }

      // Match DB server name to a built-in factory
      for (const [name, factory] of builtinFactories) {
        if (dbServer.name === name || name.includes(dbServer.name) || dbServer.name.includes(name)) {
          if (clients.has(name)) {
            clients.set(serverId, clients.get(name)!);
            return clients.get(name)!;
          }

          const srv = await factory();
          const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
          await srv.connect(serverTransport);

          const client = new Client({ name: `builtin-${name}`, version: '1.0.0' });
          await client.connect(clientTransport);
          clients.set(name, client);
          clients.set(dbServer.id, client);
          if (serverId !== name && serverId !== dbServer.id) clients.set(serverId, client);
          loggerRegistry.info(`[lt-mcp:client] auto-connected built-in server: ${name} (via DB id '${serverId}')`);
          return client;
        }
      }
    }
  } catch {
    // DB lookup failed — not critical
  }

  return null;
}

/**
 * Call a tool on a connected server.
 * Resolves the server by ID or name, auto-connecting built-in servers.
 */
export async function callServerTool(
  serverId: string,
  toolName: string,
  args: Record<string, any>,
): Promise<any> {
  const client = await resolveClient(serverId);
  if (!client) {
    throw new Error(`MCP server ${serverId} is not connected`);
  }
  const result = await client.callTool({ name: toolName, arguments: args });
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

/**
 * Connect to all auto-connect servers.
 */
export async function connectAutoServers(): Promise<void> {
  const servers = await mcpDbService.getAutoConnectServers();
  for (const server of servers) {
    // Skip built-in servers — they auto-connect lazily via resolveClient()
    // on first tool call using InMemoryTransport, not stdio/SSE.
    if ((server.transport_config as any)?.builtin) {
      continue;
    }
    try {
      await connectToServer(server);
    } catch (err: any) {
      loggerRegistry.error(`[lt-mcp:client] failed to connect to ${server.name}: ${err.message}`);
      await mcpDbService.updateMcpServerStatus(server.id, 'error');
    }
  }
}

/**
 * Disconnect all clients.
 */
export async function disconnectAll(): Promise<void> {
  for (const [serverId] of clients) {
    await disconnectFromServer(serverId);
  }
}

/**
 * Check if a server is connected.
 */
export function isConnected(serverId: string): boolean {
  return clients.has(serverId);
}

/**
 * Clear all state. Used in tests.
 */
export function clear(): void {
  clients.clear();
}
