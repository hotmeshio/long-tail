import OpenAI from 'openai';
import { Client as McpClient } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { createDbServer } from '../mcp/db-server';

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
  const server = await createDbServer();
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
 * Call the LLM (OpenAI) with messages and optional tool definitions.
 * Returns the assistant message (content + tool_calls).
 */
export async function callLLM(
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
