import OpenAI from 'openai';

import { LLM_MODEL_PRIMARY, LLM_MAX_TOKENS_DEFAULT } from '../../../modules/defaults';
import * as mcpClient from '../../../services/mcp/client';
import * as mcpDbService from '../../../services/mcp/db';

/** Maps qualified tool name → MCP server name for routing calls */
const toolServerMap = new Map<string, string>();

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
 * Call any MCP tool by its qualified name.
 * Routes to the correct server via the toolServerMap.
 */
export async function callMcpTool(
  qualifiedName: string,
  args: Record<string, any>,
): Promise<any> {
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
