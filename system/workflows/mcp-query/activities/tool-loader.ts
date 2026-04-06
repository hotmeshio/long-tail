import { loggerRegistry } from '../../../../services/logger';
import * as mcpDbService from '../../../../services/mcp/db';
import { generateStrategySection } from '../strategy-advisors';
import type { ServerInfo } from '../types';
import { toolServerMap, toolDefCache } from './caches';

/**
 * Single activity that discovers, caches, and returns lightweight tool data.
 *
 * Full ChatCompletionTool definitions are cached in module-level toolDefCache
 * so they never flow through the durable pipe. Only tool IDs (qualified name
 * strings) and a compact inventory string are returned.
 *
 * @param tags - MCP server tags to scope by. Pass undefined to load all servers.
 */
export async function loadTools(
  tags?: string[],
): Promise<{ toolIds: string[]; inventory: string; strategy: string }> {
  let servers;
  if (tags?.length) {
    servers = await mcpDbService.findServersByTags(tags, 'any');
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
    const serverTags = (server as any).tags?.length ? (server as any).tags.join(', ') : 'general';
    const toolNames: string[] = [];

    for (const t of manifest) {
      const qualifiedName = `${slug}__${t.name}`;
      toolServerMap.set(qualifiedName, server.name);
      toolDefCache.set(qualifiedName, {
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
      tags: (server as any).tags || [],
      metadata: server.metadata || null,
      toolNames,
      toolCount: manifest.length,
      slug,
    });
  }

  const strategy = generateStrategySection(serverInfos);

  return { toolIds, inventory: inventoryLines.join('\n'), strategy };
}
