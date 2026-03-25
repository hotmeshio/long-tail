import { loggerRegistry } from '../../../services/logger';
import * as mcpClient from '../../../services/mcp/client';
import * as mcpDbService from '../../../services/mcp/db';
import * as yamlDb from '../../../services/yaml-workflow/db';
import * as yamlDeployer from '../../../services/yaml-workflow/deployer';
import { generateStrategySection, type ServerInfo } from '../../workflows/mcp-query/strategy-advisors';
import { toolServerMap, yamlWorkflowMap, toolDefCache } from './cache';

/** Base tags always included — triage always needs DB for investigation + compiled workflows */
export const BASE_TAGS = ['workflows', 'compiled', 'database'];

// ── LLM + MCP tool activities ────────────────────────────────

/**
 * Single activity that discovers, caches, and returns a lightweight summary.
 *
 * Full ChatCompletionTool definitions are cached in module-level toolDefCache
 * so they never flow through the durable pipe. Only tool IDs (qualified name
 * strings) and a compact inventory string are returned.
 *
 * Includes strategy advisor section for overlapping server categories.
 *
 * @param tags - MCP server tags to scope by (merged with BASE_TAGS).
 *               Pass undefined/empty to load all servers.
 */
export async function loadTriageTools(
  tags?: string[],
): Promise<{ toolIds: string[]; inventory: string; strategy: string }> {
  loggerRegistry.debug(`[mcpTriage:loadTriageTools] tags: ${tags?.join(',') || 'all'}`);
  let servers;
  if (tags?.length) {
    const combinedTags = [...new Set([...BASE_TAGS, ...tags])];
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
      tags: server.tags || [],
      metadata: server.metadata || null,
      toolNames,
      toolCount: manifest.length,
      slug,
    });
  }

  const strategy = generateStrategySection(serverInfos);

  loggerRegistry.info(`[mcpTriage:loadTriageTools] ${servers.length} servers, ${toolIds.length} tools loaded`);

  return { toolIds, inventory: inventoryLines.join('\n'), strategy };
}

/**
 * Call any tool by its qualified name — handles both YAML workflows
 * (yaml__* prefix) and raw MCP tools (server_slug__tool_name).
 */
export async function callTriageTool(
  qualifiedName: string,
  args: Record<string, any>,
): Promise<any> {
  // Check if this is a compiled YAML workflow
  const yamlWorkflowName = yamlWorkflowMap.get(qualifiedName);
  if (yamlWorkflowName) {
    try {
      const wf = await yamlDb.getYamlWorkflowByName(yamlWorkflowName);
      if (!wf || wf.status !== 'active') {
        return { error: `Compiled workflow "${yamlWorkflowName}" is not active` };
      }
      const { job_id, result } = await yamlDeployer.invokeYamlWorkflowSync(
        wf.app_id,
        wf.graph_topic,
        args,
        undefined,
        wf.graph_topic,
      );
      return { job_id, workflow: yamlWorkflowName, status: 'completed', result };
    } catch (err: any) {
      return { error: err.message, tool: qualifiedName, args };
    }
  }

  // Standard MCP tool routing
  const serverName = toolServerMap.get(qualifiedName);
  const separatorIdx = qualifiedName.indexOf('__');
  const toolName = separatorIdx >= 0
    ? qualifiedName.slice(separatorIdx + 2)
    : qualifiedName;

  if (serverName) {
    try {
      return await mcpClient.callServerTool(serverName, toolName, args);
    } catch (err: any) {
      return { error: err.message, tool: qualifiedName, args };
    }
  }

  // Fallback: try the tool name directly against all connected servers
  const { servers } = await mcpDbService.listMcpServers({ limit: 100 });
  for (const server of servers) {
    const manifest = server.tool_manifest || [];
    if (manifest.some((t: any) => t.name === toolName)) {
      try {
        return await mcpClient.callServerTool(server.name, toolName, args);
      } catch (err: any) {
        return { error: err.message, tool: qualifiedName, args };
      }
    }
  }

  return { error: `Unknown tool: ${qualifiedName} (no server found)`, tool: qualifiedName };
}
