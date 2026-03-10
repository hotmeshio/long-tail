import OpenAI from 'openai';
import { Client as McpClient } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { LLM_MODEL_PRIMARY, LLM_MAX_TOKENS_DEFAULT } from '../../../modules/defaults';
import { createDbServer } from '../../../services/mcp/db-server';

// ── In-process MCP clients (lazy singletons) ─────────────────

// Promise-based singleton to prevent concurrent initialization races.
// Without this, two concurrent activity calls both see dbClient as null,
// both get the cached McpServer, and the second `server.connect()` throws
// "Already connected to a transport."
let dbClientPromise: Promise<InstanceType<typeof McpClient>> | null = null;

// Maps tool names to the client that owns them
const toolClientMap = new Map<string, InstanceType<typeof McpClient>>();

async function getDbClient(): Promise<InstanceType<typeof McpClient>> {
  if (!dbClientPromise) {
    dbClientPromise = initDbClient().catch((err) => {
      dbClientPromise = null; // allow retry on failure
      throw err;
    });
  }
  return dbClientPromise;
}

async function initDbClient(): Promise<InstanceType<typeof McpClient>> {
  // IMPORTANT: Create a DEDICATED server instance for this in-process client.
  // createDbServer() returns a module-level singleton that may already be
  // connected to the main MCP adapter transport. An McpServer can only be
  // connected to ONE transport at a time, so reusing it causes
  // "Already connected to a transport" errors.
  const server = await createDbServer({ name: 'insight-db-query', fresh: true });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);

  const client = new McpClient({ name: 'insight-db-client', version: '1.0.0' });
  await client.connect(clientTransport);
  return client;
}

function parseResult(result: any): any {
  const text = result.content?.[0]?.text;
  if (!text) return result;

  try {
    return JSON.parse(text);
  } catch {
    return { error: text };
  }
}

// ── Proxy activities ──────────────────────────────────────────

/**
 * List all available DB tools in OpenAI function-calling format.
 */
export async function getDbTools(): Promise<OpenAI.Chat.Completions.ChatCompletionTool[]> {
  const db = await getDbClient();
  const { tools: dbTools } = await db.listTools();

  // Register DB tools in the routing map
  for (const t of dbTools) toolClientMap.set(t.name, db);

  return dbTools.map((t) => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description || '',
      parameters: t.inputSchema as Record<string, unknown>,
    },
  }));
}

/**
 * Call a specific MCP tool (DB) and return the parsed result.
 */
export async function callDbTool(
  name: string,
  args: Record<string, any>,
): Promise<any> {
  const client = toolClientMap.get(name) || (await getDbClient());
  const result = await client.callTool({ name, arguments: args });
  return parseResult(result);
}

/**
 * Shared OpenAI client — reuses HTTP connections across calls.
 */
let _openai: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (!_openai) _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _openai;
}

export interface CallLLMOptions {
  tools?: OpenAI.Chat.Completions.ChatCompletionTool[];
  max_tokens?: number;
  response_format?: { type: 'json_object' | 'text' };
}

/**
 * Call the LLM (OpenAI) with messages and optional tool definitions.
 * Returns the assistant message (content + tool_calls).
 */
export async function callLLM(
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
  toolsOrOptions?: OpenAI.Chat.Completions.ChatCompletionTool[] | CallLLMOptions,
): Promise<OpenAI.Chat.Completions.ChatCompletionMessage> {
  // Support legacy (tools array) and new (options object) signatures
  const opts: CallLLMOptions = Array.isArray(toolsOrOptions)
    ? { tools: toolsOrOptions }
    : (toolsOrOptions || {});

  const openai = getOpenAI();
  const t0 = Date.now();
  const response = await openai.chat.completions.create({
    model: LLM_MODEL_PRIMARY,
    messages,
    ...(opts.tools?.length ? { tools: opts.tools } : {}),
    ...(opts.response_format ? { response_format: opts.response_format } : {}),
    max_tokens: opts.max_tokens ?? (opts.tools?.length ? undefined : LLM_MAX_TOKENS_DEFAULT),
  });
  const usage = response.usage;
  console.log(`[callLLM] ${Date.now() - t0}ms | in=${usage?.prompt_tokens} out=${usage?.completion_tokens} total=${usage?.total_tokens}`);
  return response.choices[0].message;
}
