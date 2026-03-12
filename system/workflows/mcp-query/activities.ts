import OpenAI from 'openai';

import { LLM_MODEL_PRIMARY, LLM_MAX_TOKENS_DEFAULT } from '../../../modules/defaults';
import * as mcpClient from '../../../services/mcp/client';
import * as mcpDbService from '../../../services/mcp/db';
import * as yamlDb from '../../../services/yaml-workflow/db';
import * as yamlDeployer from '../../../services/yaml-workflow/deployer';

/** Maps qualified tool name → MCP server name for routing calls */
const toolServerMap = new Map<string, string>();

/** Tracks which qualified names are compiled YAML workflows (not raw MCP tools) */
const yamlWorkflowMap = new Map<string, string>();

/**
 * Search for active compiled YAML workflows that match the user's prompt.
 * Extracts keywords from the prompt and searches by tags (GIN-indexed).
 * Returns a compact summary for the LLM and tools in OpenAI format.
 *
 * This is Phase 1 of tool discovery — compiled workflows are preferred
 * because they execute deterministically without LLM reasoning overhead.
 */
export async function findCompiledWorkflows(
  prompt: string,
): Promise<{
  inventory: string;
  tools: OpenAI.Chat.Completions.ChatCompletionTool[];
}> {
  // Extract search keywords from the prompt
  const keywords = prompt
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !PROMPT_STOP_WORDS.has(w));

  if (keywords.length === 0) {
    return { inventory: '', tools: [] };
  }

  // Query YAML workflows by tags using GIN index
  const workflows = await yamlDb.findYamlWorkflowsByTags(keywords, 'any');
  if (workflows.length === 0) {
    return { inventory: '', tools: [] };
  }

  const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = [];
  const inventoryLines: string[] = [];

  for (const wf of workflows) {
    const qualifiedName = `yaml__${wf.name.replace(/[^a-zA-Z0-9]/g, '_')}`;
    yamlWorkflowMap.set(qualifiedName, wf.name);

    tools.push({
      type: 'function' as const,
      function: {
        name: qualifiedName,
        description: `[COMPILED WORKFLOW] ${wf.description || wf.name} — deterministic, no LLM needed. ` +
          `Tags: ${wf.tags.join(', ')}`,
        parameters: (wf.input_schema || { type: 'object', properties: {} }) as Record<string, unknown>,
      },
    });

    const activityCount = wf.activity_manifest.filter((a) => a.type === 'worker').length;
    inventoryLines.push(
      `★ ${wf.name} [compiled, ${activityCount} steps, tags: ${wf.tags.join(', ')}]: ${wf.description || 'deterministic workflow'}`
    );
  }

  return {
    inventory: inventoryLines.join('\n'),
    tools,
  };
}

/**
 * Build a compact inventory of all MCP servers and their tools.
 * Injected into the system prompt so the LLM understands what's available.
 */
export async function getToolInventory(): Promise<string> {
  const { servers } = await mcpDbService.listMcpServers({ limit: 100 });
  const lines: string[] = [];

  for (const server of servers) {
    const manifest = server.tool_manifest || [];
    const tags = (server as any).tags?.length ? (server as any).tags.join(', ') : 'general';
    const toolNames = manifest.map((t: any) => t.name).join(', ');
    lines.push(`• ${server.name} [${tags}] (${manifest.length} tools): ${toolNames}`);
  }

  return lines.join('\n');
}

/**
 * Discover tools from available MCP servers, optionally filtered by tags.
 * Returns tools in OpenAI function-calling format with qualified names.
 */
export async function getAllTools(
  tags?: string[],
): Promise<OpenAI.Chat.Completions.ChatCompletionTool[]> {
  let servers;
  if (tags?.length) {
    // Use tag-based filtering when available
    const result = await mcpDbService.listMcpServers({ limit: 100 });
    servers = result.servers.filter((s: any) =>
      s.tags?.some((t: string) => tags.includes(t)),
    );
  } else {
    const result = await mcpDbService.listMcpServers({ limit: 100 });
    servers = result.servers;
  }

  const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = [];

  for (const server of servers) {
    const manifest = server.tool_manifest || [];
    const slug = server.name.replace(/[^a-zA-Z0-9]/g, '_');

    for (const t of manifest) {
      const qualifiedName = `${slug}__${t.name}`;
      toolServerMap.set(qualifiedName, server.name);

      tools.push({
        type: 'function' as const,
        function: {
          name: qualifiedName,
          description: `[${server.name}] ${t.description || ''}`,
          parameters: (t.inputSchema || { type: 'object', properties: {} }) as Record<string, unknown>,
        },
      });
    }
  }

  return tools;
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
 * Call the LLM with messages and optional tool definitions.
 */
export async function callLLM(
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
  tools?: OpenAI.Chat.Completions.ChatCompletionTool[],
): Promise<OpenAI.Chat.Completions.ChatCompletionMessage> {
  const openai = getOpenAI();
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
