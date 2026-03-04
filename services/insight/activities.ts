import OpenAI from 'openai';
import { Client as McpClient } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { createDbServer } from '../mcp/db-server';

// ── In-process DB MCP client (lazy singleton) ────────────────

let client: InstanceType<typeof McpClient> | null = null;

async function getClient(): Promise<InstanceType<typeof McpClient>> {
  if (client) return client;

  const server = await createDbServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);

  client = new McpClient({ name: 'insight-query-client', version: '1.0.0' });
  await client.connect(clientTransport);
  return client;
}

function parseResult(result: any): any {
  if (result.content?.[0]?.text) {
    return JSON.parse(result.content[0].text);
  }
  return result;
}

// ── Proxy activities ──────────────────────────────────────────

/**
 * List all available DB tools and return them in OpenAI function-calling format.
 */
export async function getDbTools(): Promise<OpenAI.Chat.Completions.ChatCompletionTool[]> {
  const c = await getClient();
  const { tools } = await c.listTools();

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
 * Call a specific DB MCP tool and return the parsed result.
 */
export async function callDbTool(
  name: string,
  args: Record<string, any>,
): Promise<any> {
  const c = await getClient();
  const result = await c.callTool({ name, arguments: args });
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
