import OpenAI from 'openai';
import { Client as McpClient } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { createVisionServer } from '../../../services/mcp/vision-server';
import * as taskService from '../../../services/task';
import * as escalationService from '../../../services/escalation';
import type { LTTaskRecord, LTEscalationRecord } from '../../../types';

// ── In-process Vision MCP client (lazy singleton) ─────────────

let visionClient: InstanceType<typeof McpClient> | null = null;
const toolClientMap = new Map<string, InstanceType<typeof McpClient>>();

async function getVisionClient(): Promise<InstanceType<typeof McpClient>> {
  if (visionClient) return visionClient;

  const server = await createVisionServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);

  visionClient = new McpClient({ name: 'mcp-triage-client', version: '1.0.0' });
  await visionClient.connect(clientTransport);
  return visionClient;
}

function parseResult(result: any): any {
  const text = result.content?.[0]?.text;
  if (!text) return result;

  // MCP error responses or non-JSON text — return as-is for the LLM to interpret
  try {
    return JSON.parse(text);
  } catch {
    return { error: text };
  }
}

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
 * List all available Vision MCP tools in OpenAI function-calling format.
 * These are the document processing tools the LLM can choose from.
 */
export async function getVisionTools(): Promise<OpenAI.Chat.Completions.ChatCompletionTool[]> {
  const client = await getVisionClient();
  const { tools } = await client.listTools();

  for (const t of tools) toolClientMap.set(t.name, client);

  return tools.map((t) => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description || '',
      parameters: t.inputSchema as Record<string, unknown>,
    },
  }));
}

/**
 * Call a specific Vision MCP tool and return the parsed result.
 * The LLM decides which tool to call — this executes it.
 */
export async function callVisionTool(
  name: string,
  args: Record<string, any>,
): Promise<any> {
  const client = toolClientMap.get(name) || (await getVisionClient());
  const result = await client.callTool({ name, arguments: args });
  return parseResult(result);
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
    model: 'gpt-4o-mini',
    messages,
    ...(tools?.length ? { tools } : {}),
  });
  return response.choices[0].message;
}
