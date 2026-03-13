import OpenAI from 'openai';

import { LLM_MODEL_PRIMARY, LLM_MAX_TOKENS_DEFAULT } from '../../../modules/defaults';
import * as mcpClient from '../../../services/mcp/client';
import * as mcpDbService from '../../../services/mcp/db';
import * as yamlDb from '../../../services/yaml-workflow/db';
import * as yamlDeployer from '../../../services/yaml-workflow/deployer';

// ── Tool caches (module-level, persist across proxy activity calls) ──

/** Maps qualified tool name → MCP server name for routing calls */
const toolServerMap = new Map<string, string>();

/** Tracks which qualified names are compiled YAML workflows (not raw MCP tools) */
const yamlWorkflowMap = new Map<string, string>();

/** Maps qualified tool name → full ChatCompletionTool definition */
const toolDefCache = new Map<string, OpenAI.Chat.Completions.ChatCompletionTool>();

/**
 * Search for active compiled YAML workflows that match the user's prompt.
 * Extracts keywords from the prompt and searches by tags (GIN-indexed).
 * Returns a compact summary for the LLM and tool IDs.
 *
 * Full tool definitions are cached in module-level toolDefCache — only
 * lightweight IDs flow through the durable pipe.
 *
 * This is Phase 1 of tool discovery — compiled workflows are preferred
 * because they execute deterministically without LLM reasoning overhead.
 */
export async function findCompiledWorkflows(
  prompt: string,
): Promise<{
  inventory: string;
  toolIds: string[];
}> {
  // Extract search keywords from the prompt
  const keywords = prompt
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !PROMPT_STOP_WORDS.has(w));

  if (keywords.length === 0) {
    return { inventory: '', toolIds: [] };
  }

  // Query YAML workflows by tags using GIN index
  const workflows = await yamlDb.findYamlWorkflowsByTags(keywords, 'any');
  if (workflows.length === 0) {
    return { inventory: '', toolIds: [] };
  }

  const toolIds: string[] = [];
  const inventoryLines: string[] = [];

  for (const wf of workflows) {
    const qualifiedName = `yaml__${wf.name.replace(/[^a-zA-Z0-9]/g, '_')}`;
    yamlWorkflowMap.set(qualifiedName, wf.name);

    toolDefCache.set(qualifiedName, {
      type: 'function' as const,
      function: {
        name: qualifiedName,
        description: `[COMPILED WORKFLOW] ${wf.description || wf.name} — deterministic, no LLM needed. ` +
          `Tags: ${wf.tags.join(', ')}`,
        parameters: (wf.input_schema || { type: 'object', properties: {} }) as Record<string, unknown>,
      },
    });

    toolIds.push(qualifiedName);

    const activityCount = wf.activity_manifest.filter((a) => a.type === 'worker').length;
    inventoryLines.push(
      `★ ${wf.name} [compiled, ${activityCount} steps, tags: ${wf.tags.join(', ')}]: ${wf.description || 'deterministic workflow'}`
    );
  }

  return {
    inventory: inventoryLines.join('\n'),
    toolIds,
  };
}

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
): Promise<{ toolIds: string[]; inventory: string }> {
  let servers;
  if (tags?.length) {
    servers = await mcpDbService.findServersByTags(tags, 'any');
  } else {
    const result = await mcpDbService.listMcpServers({ limit: 100 });
    servers = result.servers;
  }

  const toolIds: string[] = [];
  const inventoryLines: string[] = [];

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
  }

  return { toolIds, inventory: inventoryLines.join('\n') };
}

/**
 * Call any tool by its qualified name — handles both YAML workflows
 * (yaml__* prefix) and raw MCP tools (server_slug__tool_name).
 */
export async function callMcpTool(
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

const PROMPT_STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'that', 'this', 'are', 'was',
  'not', 'but', 'has', 'have', 'had', 'been', 'will', 'can', 'all',
  'please', 'take', 'make', 'show', 'get', 'use', 'find', 'give',
  'want', 'need', 'would', 'could', 'should', 'about', 'what', 'how',
]);

/**
 * Shared OpenAI client — reuses HTTP connections across calls.
 */
let _openai: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (!_openai) _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _openai;
}

/**
 * Call the LLM with messages and optional tool IDs.
 *
 * Tool IDs are resolved from the module-level toolDefCache so that only
 * lightweight string arrays flow through the durable pipe.
 */
export async function callLLM(
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
  toolIds?: string[],
): Promise<OpenAI.Chat.Completions.ChatCompletionMessage> {
  const openai = getOpenAI();

  // Resolve full tool definitions from module-level cache
  let tools: OpenAI.Chat.Completions.ChatCompletionTool[] | undefined;
  if (toolIds?.length) {
    tools = toolIds
      .map((id) => toolDefCache.get(id))
      .filter((t): t is OpenAI.Chat.Completions.ChatCompletionTool => !!t);
  }

  const t0 = Date.now();
  const response = await openai.chat.completions.create({
    model: LLM_MODEL_PRIMARY,
    messages,
    ...(tools?.length ? { tools } : {}),
    ...(!tools?.length ? { max_tokens: LLM_MAX_TOKENS_DEFAULT } : {}),
  });
  const usage = response.usage;
  console.log(`[mcpQuery:callLLM] ${Date.now() - t0}ms | in=${usage?.prompt_tokens} out=${usage?.completion_tokens} total=${usage?.total_tokens}`);
  return response.choices[0].message;
}
