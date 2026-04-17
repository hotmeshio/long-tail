import { loggerRegistry } from '../../../lib/logger';
import type { ToolDefinition } from '../../../services/llm';
import * as mcpDbService from '../../../services/mcp/db';
import { generateStrategySection } from './strategy-advisors';
import type { ServerInfo } from './types';

/**
 * Discover MCP servers, cache tool definitions, and return a lightweight
 * summary for the durable pipe.
 *
 * Callers pass their own module-level caches so each pipeline keeps
 * isolated cache instances. Optional `baseTags` are merged before querying.
 */
export async function loadToolsFromServers(
  tags: string[] | undefined,
  caches: {
    toolServerMap: Map<string, string>;
    toolDefCache: Map<string, ToolDefinition>;
  },
  opts?: { baseTags?: string[]; logPrefix?: string },
): Promise<{ toolIds: string[]; inventory: string; strategy: string }> {
  const prefix = opts?.logPrefix || 'shared';

  let servers;
  if (tags?.length || opts?.baseTags?.length) {
    const combinedTags = [...new Set([...(opts?.baseTags || []), ...(tags || [])])];
    servers = await mcpDbService.findServersByTags(combinedTags, 'any');
  } else {
    const result = await mcpDbService.listMcpServers({ limit: 100 });
    servers = result.servers;
  }

  const toolIds: string[] = [];
  const inventoryLines: string[] = [];
  const serverInfos: ServerInfo[] = [];

  for (const server of servers) {
    const manifest = server.tool_manifest || [];
    const slug = server.name.replace(/[^a-zA-Z0-9]/g, '_');
    const serverTags = server.tags?.length ? server.tags.join(', ') : 'general';
    const toolNames: string[] = [];

    for (const t of manifest) {
      const qualifiedName = `${slug}__${t.name}`;
      caches.toolServerMap.set(qualifiedName, server.name);
      caches.toolDefCache.set(qualifiedName, {
        type: 'function' as const,
        function: {
          name: qualifiedName,
          description: `[${server.name}] ${t.description || ''}`,
          parameters: (t.inputSchema || { type: 'object', properties: {} }) as Record<string, unknown>,
        },
      });
      toolIds.push(qualifiedName);
      toolNames.push(t.name);
    }

    inventoryLines.push(
      `• ${server.name} [${serverTags}] (${manifest.length} tools): ${toolNames.join(', ')}`,
    );

    serverInfos.push({
      name: server.name,
      description: server.description || null,
      tags: server.tags || [],
      metadata: server.metadata || null,
      toolNames,
      toolCount: manifest.length,
      slug,
    });
  }

  const strategy = generateStrategySection(serverInfos);

  loggerRegistry.info(`[${prefix}:loadTools] ${servers.length} servers, ${toolIds.length} tools loaded`);

  return { toolIds, inventory: inventoryLines.join('\n'), strategy };
}
