import { callLLM as callLLMService, type ToolDefinition, type LLMResponse } from '../../services/llm';
import { LLM_MODEL_PRIMARY, LLM_MODEL_SECONDARY, LLM_MAX_TOKENS_DEFAULT } from '../../modules/defaults';
import { WORKFLOW_MATCH_PROMPT, EXTRACT_INPUTS_PROMPT } from '../workflows/mcp-query/prompts';
import { loggerRegistry } from '../../services/logger';
import { ltConfig } from '../../modules/ltconfig';
import * as mcpClient from '../../services/mcp/client';
import * as mcpDbService from '../../services/mcp/db';
import * as yamlDb from '../../services/yaml-workflow/db';
import * as yamlDeployer from '../../services/yaml-workflow/deployer';
import * as taskService from '../../services/task';
import * as escalationService from '../../services/escalation';
import { generateStrategySection, type ServerInfo } from '../workflows/mcp-query/strategy-advisors';
import type { LTTaskRecord, LTEscalationRecord } from '../../types';

// ── Tool caches (module-level, persist across proxy activity calls) ──

/** Maps qualified tool name → MCP server name for routing calls */
const toolServerMap = new Map<string, string>();

/** Tracks which qualified names are compiled YAML workflows */
const yamlWorkflowMap = new Map<string, string>();

/** Maps qualified tool name → full ChatCompletionTool definition */
const toolDefCache = new Map<string, ToolDefinition>();

/** Base tags always included — triage always needs DB for investigation + compiled workflows */
const BASE_TAGS = ['workflows', 'compiled', 'database'];

// ── Context activities ────────────────────────────────────────

/**
 * Query all tasks sharing an originId.
 * Gives the triage workflow full context of upstream work.
 */
export async function getUpstreamTasks(
  originId: string,
): Promise<LTTaskRecord[]> {
  const { tasks } = await taskService.listTasks({
    origin_id: originId,
    limit: 100,
  });
  return tasks;
}

/**
 * Query all escalations sharing an originId.
 * Gives the triage workflow the full conversation history.
 */
export async function getEscalationHistory(
  originId: string,
): Promise<LTEscalationRecord[]> {
  return escalationService.getEscalationsByOriginId(originId);
}

/**
 * Create an escalation to the engineering team with a recommendation.
 * Used by the triage workflow to surface long-term fixes (non-blocking).
 */
export async function notifyEngineering(
  originId: string,
  description: string,
  metadata?: Record<string, any>,
): Promise<void> {
  await escalationService.createEscalation({
    type: 'triage_recommendation',
    subtype: 'pipeline_fix',
    modality: 'async',
    description,
    priority: 3,
    origin_id: originId,
    role: 'engineer',
    envelope: JSON.stringify({}),
    metadata: {
      ...metadata,
      source: 'mcp_triage',
      auto_generated: true,
    },
  });
}

// ── Tool scoping ─────────────────────────────────────────────

/**
 * Look up tool_tags for a workflow type from lt_config_workflows (cached).
 * Returns empty array if the workflow type has no tags configured.
 */
export async function getToolTags(
  workflowType: string,
): Promise<string[]> {
  const tags = await ltConfig.getToolTags(workflowType);
  loggerRegistry.debug(`[mcpTriage:getToolTags] ${workflowType} → [${tags.join(',')}]`);
  return tags;
}

// ── Compiled workflow discovery (shared with mcpQuery) ────────

const PROMPT_STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'that', 'this', 'are', 'was',
  'not', 'but', 'has', 'have', 'had', 'been', 'will', 'can', 'all',
  'please', 'take', 'make', 'show', 'get', 'use', 'find', 'give',
  'want', 'need', 'would', 'could', 'should', 'about', 'what', 'how',
]);

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
 * Search for active compiled YAML workflows matching a text query.
 * Uses PostgreSQL FTS + tag overlap for ranked matching.
 */
export async function findTriageWorkflows(
  prompt: string,
): Promise<{
  inventory: string;
  toolIds: string[];
  candidates: WorkflowCandidate[];
}> {
  loggerRegistry.debug(`[mcpTriage:findTriageWorkflows] searching: ${prompt.slice(0, 60)}`);
  const keywords = prompt
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !PROMPT_STOP_WORDS.has(w));
  loggerRegistry.debug(`[mcpTriage:findTriageWorkflows] keywords: [${keywords.join(',')}]`);

  let workflows: Awaited<ReturnType<typeof yamlDb.discoverWorkflows>>;
  try {
    workflows = await yamlDb.discoverWorkflows(prompt, keywords, undefined, 5);
    loggerRegistry.info(`[mcpTriage:findTriageWorkflows] ${workflows.length} candidate(s) found`);
  } catch (err: any) {
    loggerRegistry.warn(`[mcpTriage:findTriageWorkflows] discovery failed: ${err.message}`);
    return { inventory: '', toolIds: [], candidates: [] };
  }

  if (workflows.length === 0) {
    loggerRegistry.debug(`[mcpTriage:findTriageWorkflows] no candidates found`);
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

/**
 * Call the LLM with messages and optional tool IDs.
 *
 * Uses the primary model for better tool-calling reliability.
 * Tool IDs are resolved from the module-level toolDefCache so that only
 * lightweight string arrays flow through the durable pipe.
 */
export async function callTriageLLM(
  messages: any[],
  toolIds?: string[],
): Promise<LLMResponse> {
  let tools: ToolDefinition[] | undefined;
  if (toolIds?.length) {
    tools = toolIds
      .map((id) => toolDefCache.get(id))
      .filter((t): t is ToolDefinition => !!t);
  }

  const t0 = Date.now();
  loggerRegistry.debug(`[mcpTriage:callLLM] ${tools?.length || 0} tools, ${messages.length} messages`);
  const response = await callLLMService({
    model: LLM_MODEL_PRIMARY,
    messages,
    temperature: 0,
    ...(tools?.length ? { tools } : {}),
    ...(!tools?.length ? { max_tokens: LLM_MAX_TOKENS_DEFAULT } : {}),
  });
  const usage = response.usage;
  loggerRegistry.info(`[mcpTriage:callLLM] ${Date.now() - t0}ms | in=${usage?.prompt_tokens} out=${usage?.completion_tokens} total=${usage?.total_tokens} | tool_calls=${response.tool_calls?.length || 0}`);
  return response;
}

// ── Compiled workflow matching (reused by mcpTriageRouter) ────

/**
 * LLM-as-judge: does a compiled workflow match the triage context?
 */
export async function evaluateTriageMatch(
  prompt: string,
  candidates: WorkflowCandidate[],
): Promise<{ matched: boolean; workflowName: string | null; confidence: number }> {
  loggerRegistry.debug(`[mcpTriage:evaluateTriageMatch] ${candidates.length} candidate(s)`);
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
 * Extract structured inputs from the triage context using a workflow's input schema.
 */
export async function extractTriageInputs(
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
    delete result._extraction_failed;
    return { inputs: result, extracted: true };
  } catch {
    return { inputs: null, extracted: false };
  }
}
