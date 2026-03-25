import { callLLM as callLLMService, type ToolDefinition, type LLMResponse } from '../../../services/llm';
import { LLM_MODEL_PRIMARY, LLM_MODEL_SECONDARY, LLM_MAX_TOKENS_DEFAULT } from '../../../modules/defaults';
import { loggerRegistry } from '../../../services/logger';
import * as mcpClient from '../../../services/mcp/client';
import * as mcpDbService from '../../../services/mcp/db';
import * as yamlDb from '../../../services/yaml-workflow/db';
import * as yamlDeployer from '../../../services/yaml-workflow/deployer';
import { WORKFLOW_MATCH_PROMPT, EXTRACT_INPUTS_PROMPT } from './prompts';
import { generateStrategySection, type ServerInfo } from './strategy-advisors';

// ── Tool caches (module-level, persist across proxy activity calls) ──

/** Maps qualified tool name → MCP server name for routing calls */
const toolServerMap = new Map<string, string>();

/** Tracks which qualified names are compiled YAML workflows (not raw MCP tools) */
const yamlWorkflowMap = new Map<string, string>();

/** Maps qualified tool name → full tool definition */
const toolDefCache = new Map<string, ToolDefinition>();

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
/** Candidate workflow returned by ranked discovery. */
export interface WorkflowCandidate {
  name: string;
  description: string | null;
  original_prompt: string | null;
  category: string | null;
  tags: string[];
  input_schema: Record<string, unknown>;
  tool_names: string[];
  fts_rank: number;
}

/**
 * Phase 1: Ranked discovery of compiled YAML workflows.
 *
 * Uses PostgreSQL full-text search (tsvector) + tag overlap for
 * multi-signal ranked matching. Returns candidates for the LLM judge.
 */
export async function findCompiledWorkflows(
  prompt: string,
): Promise<{
  inventory: string;
  toolIds: string[];
  candidates: WorkflowCandidate[];
}> {
  // Extract keywords for tag-overlap signal
  const keywords = prompt
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !PROMPT_STOP_WORDS.has(w));

  // Ranked discovery: FTS + tag overlap
  const workflows = await yamlDb.discoverWorkflows(prompt, keywords, undefined, 5);

  if (workflows.length === 0) {
    return { inventory: '', toolIds: [], candidates: [] };
  }

  const toolIds: string[] = [];
  const inventoryLines: string[] = [];
  const candidates: WorkflowCandidate[] = [];

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

    const activityCount = wf.activity_manifest.filter((a: any) => a.type === 'worker').length;
    inventoryLines.push(
      `★ ${wf.name} [compiled, ${activityCount} steps, tags: ${wf.tags.join(', ')}]: ${wf.description || 'deterministic workflow'}`
    );

    candidates.push({
      name: wf.name,
      description: wf.description,
      original_prompt: wf.original_prompt,
      category: wf.category,
      tags: wf.tags,
      input_schema: wf.input_schema,
      tool_names: wf.activity_manifest
        .filter((a: any) => a.type === 'worker' && a.mcp_tool_name)
        .map((a: any) => a.mcp_tool_name),
      fts_rank: (wf as any).fts_rank || 0,
    });
  }

  return { inventory: inventoryLines.join('\n'), toolIds, candidates };
}

/**
 * Phase 2: LLM-as-judge evaluates whether any discovered workflow
 * matches the user's intent. One cheap call (mini model, ~200 tokens)
 * to potentially skip the entire agentic loop.
 */
export async function evaluateWorkflowMatch(
  prompt: string,
  candidates: WorkflowCandidate[],
): Promise<{ matched: boolean; workflowName: string | null; confidence: number }> {
  if (candidates.length === 0) {
    return { matched: false, workflowName: null, confidence: 0 };
  }

  const candidateText = candidates.map((c, i) =>
    `${i + 1}. **${c.name}** (category: ${c.category || 'general'})\n` +
    `   Description: ${c.description || 'N/A'}\n` +
    `   Original prompt: "${c.original_prompt || 'N/A'}"\n` +
    `   Tools: ${c.tool_names.join(', ')}\n` +
    `   Input: ${JSON.stringify(c.input_schema).slice(0, 300)}`
  ).join('\n\n');

  try {
    const response = await callLLMService({
      model: LLM_MODEL_SECONDARY,
      max_tokens: 200,
      temperature: 0,
      messages: [
        { role: 'system', content: WORKFLOW_MATCH_PROMPT },
        { role: 'user', content: `## User Request\n${prompt}\n\n## Candidate Workflows\n${candidateText}` },
      ],
    });

    const raw = response.content || '{}';
    const cleaned = raw.replace(/^```(?:json)?\s*/m, '').replace(/\s*```$/m, '').trim();
    const result = JSON.parse(cleaned);

    if (result.match && result.confidence >= 0.7) {
      return { matched: true, workflowName: result.workflow_name, confidence: result.confidence };
    }
    return { matched: false, workflowName: null, confidence: result.confidence || 0 };
  } catch {
    return { matched: false, workflowName: null, confidence: 0 };
  }
}

/**
 * Phase 2b: Extract structured inputs from the user's prompt using the
 * matched workflow's input_schema. Acts as a second confirmation gate —
 * if the LLM can't map the prompt to the schema, the match is rejected.
 */
export async function extractWorkflowInputs(
  prompt: string,
  inputSchema: Record<string, unknown>,
  workflowName: string,
): Promise<{ inputs: Record<string, any> | null; extracted: boolean }> {
  try {
    const response = await callLLMService({
      model: LLM_MODEL_SECONDARY,
      max_tokens: 500,
      temperature: 0,
      messages: [
        { role: 'system', content: EXTRACT_INPUTS_PROMPT },
        {
          role: 'user',
          content:
            `## User Request\n${prompt}\n\n` +
            `## Workflow: ${workflowName}\n` +
            `## Input Schema\n${JSON.stringify(inputSchema, null, 2)}`,
        },
      ],
    });

    const raw = response.content || '{}';
    const cleaned = raw.replace(/^```(?:json)?\s*/m, '').replace(/\s*```$/m, '').trim();
    const result = JSON.parse(cleaned);

    if (result._extraction_failed) {
      return { inputs: null, extracted: false };
    }

    // Remove the meta field before passing to the workflow
    delete result._extraction_failed;
    return { inputs: result, extracted: true };
  } catch {
    return { inputs: null, extracted: false };
  }
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
 * Call the LLM with messages and optional tool IDs.
 *
 * Tool IDs are resolved from the module-level toolDefCache so that only
 * lightweight string arrays flow through the durable pipe.
 */
export async function callQueryLLM(
  messages: any[],
  toolIds?: string[],
): Promise<LLMResponse> {
  // Resolve full tool definitions from module-level cache
  let tools: ToolDefinition[] | undefined;
  if (toolIds?.length) {
    tools = toolIds
      .map((id) => toolDefCache.get(id))
      .filter((t): t is ToolDefinition => !!t);
  }

  const t0 = Date.now();
  const response = await callLLMService({
    model: LLM_MODEL_PRIMARY,
    messages,
    temperature: 0,
    ...(tools?.length ? { tools } : {}),
    ...(!tools?.length ? { max_tokens: LLM_MAX_TOKENS_DEFAULT } : {}),
  });
  const usage = response.usage;
  loggerRegistry.info(`[mcpQuery:callLLM] ${Date.now() - t0}ms | in=${usage?.prompt_tokens} out=${usage?.completion_tokens} total=${usage?.total_tokens}`);
  return response;
}
