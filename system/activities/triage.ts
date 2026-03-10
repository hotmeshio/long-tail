import OpenAI from 'openai';

import { LLM_MODEL_SECONDARY } from '../../modules/defaults';
import * as mcpClient from '../../services/mcp/client';
import * as mcpDbService from '../../services/mcp/db';
import * as taskService from '../../services/task';
import * as escalationService from '../../services/escalation';
import type { LTTaskRecord, LTEscalationRecord } from '../../types';

// ── Tool → server routing ────────────────────────────────────

/** Maps qualified tool name → MCP server name for routing calls */
const toolServerMap = new Map<string, string>();

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

// ── LLM + MCP tool activities ────────────────────────────────

/**
 * Build a compact inventory of all MCP servers and their tools.
 * Injected into the system prompt so the LLM understands what's available
 * before making any tool calls.
 */
export async function getToolInventory(): Promise<string> {
  const { servers } = await mcpDbService.listMcpServers({ limit: 100 });
  const lines: string[] = [];

  for (const server of servers) {
    const manifest = server.tool_manifest || [];
    const category = (server.metadata as any)?.category || 'general';
    const toolNames = manifest.map((t: any) => t.name).join(', ');
    lines.push(`• ${server.name} [${category}] (${manifest.length} tools): ${toolNames}`);
  }

  return lines.join('\n');
}

/**
 * Discover tools from ALL available MCP servers.
 *
 * Queries the DB for connected/built-in servers, aggregates their tool
 * manifests, and returns them in OpenAI function-calling format. Each tool
 * name is prefixed with the server slug so we can route calls back.
 *
 * Example: `long_tail_document_vision__rotate_page`
 */
export async function getAvailableTools(): Promise<OpenAI.Chat.Completions.ChatCompletionTool[]> {
  const { servers } = await mcpDbService.listMcpServers({ limit: 100 });
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
 * Call any MCP tool by its qualified name (e.g. `long_tail_document_vision__rotate_page`).
 *
 * Resolves the server from the tool name prefix and delegates to the
 * central MCP client which handles built-in auto-connection and routing.
 */
export async function callTool(
  qualifiedName: string,
  args: Record<string, any>,
): Promise<any> {
  const serverName = toolServerMap.get(qualifiedName);

  // Parse: slug__toolName → extract the actual tool name
  const separatorIdx = qualifiedName.indexOf('__');
  const toolName = separatorIdx >= 0
    ? qualifiedName.slice(separatorIdx + 2)
    : qualifiedName;

  if (serverName) {
    try {
      return await mcpClient.callServerTool(serverName, toolName, args);
    } catch (err: any) {
      // Return error as data so the LLM can adapt rather than crashing the workflow
      return { error: err.message, tool: qualifiedName, args };
    }
  }

  // Fallback: try the tool name directly (unqualified) against all connected servers
  // This handles cases where the LLM drops the prefix
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
 * Call the LLM (OpenAI) with messages and optional tool definitions.
 * Returns the assistant message (content + tool_calls).
 */
export async function callTriageLLM(
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
  tools?: OpenAI.Chat.Completions.ChatCompletionTool[],
): Promise<OpenAI.Chat.Completions.ChatCompletionMessage> {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const response = await openai.chat.completions.create({
    model: LLM_MODEL_SECONDARY,
    messages,
    ...(tools?.length ? { tools } : {}),
  });
  return response.choices[0].message;
}
