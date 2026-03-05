import OpenAI from 'openai';
import { Client as McpClient } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { createDbServer } from '../mcp/db-server';
import { createTelemetryServer } from '../mcp/telemetry-server';

// ── In-process MCP clients (lazy singletons) ─────────────────

let dbClient: InstanceType<typeof McpClient> | null = null;
let telemetryClient: InstanceType<typeof McpClient> | null = null;

// Maps tool names to the client that owns them
const toolClientMap = new Map<string, InstanceType<typeof McpClient>>();

async function getDbClient(): Promise<InstanceType<typeof McpClient>> {
  if (dbClient) return dbClient;

  const server = await createDbServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);

  dbClient = new McpClient({ name: 'insight-db-client', version: '1.0.0' });
  await dbClient.connect(clientTransport);
  return dbClient;
}

async function getTelemetryClient(): Promise<InstanceType<typeof McpClient> | null> {
  if (telemetryClient) return telemetryClient;
  if (!process.env.HONEYCOMB_TEAM || !process.env.HONEYCOMB_ENVIRONMENT) return null;

  const server = await createTelemetryServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);

  telemetryClient = new McpClient({ name: 'insight-telemetry-client', version: '1.0.0' });
  await telemetryClient.connect(clientTransport);
  return telemetryClient;
}

function parseResult(result: any): any {
  if (result.content?.[0]?.text) {
    return JSON.parse(result.content[0].text);
  }
  return result;
}

// ── Proxy activities ──────────────────────────────────────────

/**
 * List all available tools (DB + telemetry) in OpenAI function-calling format.
 */
export async function getDbTools(): Promise<OpenAI.Chat.Completions.ChatCompletionTool[]> {
  const db = await getDbClient();
  const { tools: dbTools } = await db.listTools();

  // Register DB tools in the routing map
  for (const t of dbTools) toolClientMap.set(t.name, db);

  const allTools = [...dbTools];

  // Add telemetry tools if Honeycomb is configured
  const tel = await getTelemetryClient();
  if (tel) {
    const { tools: telTools } = await tel.listTools();
    for (const t of telTools) toolClientMap.set(t.name, tel);
    allTools.push(...telTools);
  }

  return allTools.map((t) => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description || '',
      parameters: t.inputSchema as Record<string, unknown>,
    },
  }));
}

/**
 * Call a specific MCP tool (DB or telemetry) and return the parsed result.
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
