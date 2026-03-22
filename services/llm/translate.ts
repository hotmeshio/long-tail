/**
 * Message format translation between OpenAI (canonical) and Anthropic.
 *
 * OpenAI's chat completion format is the canonical representation used
 * throughout the codebase. This module translates to/from Anthropic's
 * format when a Claude model is selected.
 */

import type {
  ChatMessage,
  ContentPart,
  ToolDefinition,
  ToolCall,
  LLMResponse,
} from './types';

// ── OpenAI → Anthropic ───────────────────────────────────────────────────────

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | AnthropicContentBlock[];
}

type AnthropicContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string };

interface AnthropicTool {
  name: string;
  description?: string;
  input_schema: Record<string, unknown>;
}

/**
 * Extract system messages and translate the rest for Anthropic's API.
 */
export function translateMessagesToAnthropic(
  messages: ChatMessage[],
): { system: string; messages: AnthropicMessage[] } {
  // 1. Extract system messages into a single system string
  const systemParts: string[] = [];
  const nonSystem: ChatMessage[] = [];

  for (const msg of messages) {
    if (msg.role === 'system') {
      const text = typeof msg.content === 'string'
        ? msg.content
        : Array.isArray(msg.content)
          ? msg.content.filter(p => p.type === 'text').map(p => (p as { text: string }).text).join('\n')
          : '';
      if (text) systemParts.push(text);
    } else {
      nonSystem.push(msg);
    }
  }

  // 2. Translate non-system messages
  const translated: AnthropicMessage[] = [];

  for (const msg of nonSystem) {
    if (msg.role === 'assistant') {
      const blocks: AnthropicContentBlock[] = [];

      // Text content
      if (typeof msg.content === 'string' && msg.content) {
        blocks.push({ type: 'text', text: msg.content });
      }

      // Tool calls → tool_use blocks
      if (msg.tool_calls?.length) {
        for (const tc of msg.tool_calls) {
          let input: Record<string, unknown> = {};
          try { input = JSON.parse(tc.function.arguments || '{}'); } catch { /* empty */ }
          blocks.push({
            type: 'tool_use',
            id: tc.id,
            name: tc.function.name,
            input,
          });
        }
      }

      if (blocks.length > 0) {
        translated.push({ role: 'assistant', content: blocks });
      } else {
        // Empty assistant message — use empty text
        translated.push({ role: 'assistant', content: [{ type: 'text', text: '' }] });
      }
    } else if (msg.role === 'tool') {
      // Tool result → merge into preceding or new user message
      const toolResult: AnthropicContentBlock = {
        type: 'tool_result',
        tool_use_id: msg.tool_call_id || '',
        content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
      };

      // Anthropic requires tool_result in a user message
      const last = translated[translated.length - 1];
      if (last?.role === 'user' && Array.isArray(last.content)) {
        (last.content as AnthropicContentBlock[]).push(toolResult);
      } else {
        translated.push({ role: 'user', content: [toolResult] });
      }
    } else {
      // User message
      const content = translateContentToAnthropic(msg.content);
      translated.push({ role: 'user', content });
    }
  }

  // 3. Anthropic requires alternating user/assistant. Merge consecutive same-role.
  const merged = mergeConsecutiveRoles(translated);

  return { system: systemParts.join('\n\n'), messages: merged };
}

/**
 * Translate content parts from OpenAI to Anthropic format.
 */
function translateContentToAnthropic(
  content: string | ContentPart[] | null,
): string | AnthropicContentBlock[] {
  if (content === null) return '';
  if (typeof content === 'string') return content;

  const blocks: AnthropicContentBlock[] = [];
  for (const part of content) {
    if (part.type === 'text') {
      blocks.push({ type: 'text', text: part.text });
    } else if (part.type === 'image_url') {
      const parsed = parseDataUrl(part.image_url.url);
      if (parsed) {
        blocks.push({
          type: 'image',
          source: { type: 'base64', media_type: parsed.mediaType, data: parsed.data },
        });
      }
    }
  }
  return blocks.length > 0 ? blocks : '';
}

/**
 * Parse a data: URL into media type and base64 data.
 */
function parseDataUrl(url: string): { mediaType: string; data: string } | null {
  const match = url.match(/^data:([^;]+);base64,(.+)$/);
  if (match) return { mediaType: match[1], data: match[2] };
  // For regular URLs, Anthropic can't handle them — would need to fetch
  return null;
}

/**
 * Merge consecutive messages with the same role (Anthropic requirement).
 */
function mergeConsecutiveRoles(messages: AnthropicMessage[]): AnthropicMessage[] {
  const merged: AnthropicMessage[] = [];
  for (const msg of messages) {
    const last = merged[merged.length - 1];
    if (last?.role === msg.role) {
      // Merge content
      const lastBlocks = Array.isArray(last.content)
        ? last.content
        : [{ type: 'text' as const, text: last.content }];
      const newBlocks = Array.isArray(msg.content)
        ? msg.content
        : [{ type: 'text' as const, text: msg.content }];
      last.content = [...lastBlocks, ...newBlocks] as AnthropicContentBlock[];
    } else {
      merged.push({ ...msg });
    }
  }
  return merged;
}

/**
 * Translate OpenAI tool definitions to Anthropic format.
 */
export function translateToolsToAnthropic(tools: ToolDefinition[]): AnthropicTool[] {
  return tools.map(t => ({
    name: t.function.name,
    description: t.function.description,
    input_schema: t.function.parameters || { type: 'object', properties: {} },
  }));
}

// ── Anthropic → OpenAI (response translation) ────────────────────────────────

/**
 * Translate an Anthropic response to our canonical LLMResponse.
 */
export function translateAnthropicResponse(response: {
  content: Array<{ type: string; text?: string; id?: string; name?: string; input?: unknown }>;
  usage?: { input_tokens: number; output_tokens: number };
  stop_reason?: string;
}): LLMResponse {
  let textContent = '';
  const toolCalls: ToolCall[] = [];

  for (const block of response.content) {
    if (block.type === 'text' && block.text) {
      textContent += block.text;
    } else if (block.type === 'tool_use') {
      toolCalls.push({
        id: block.id || `call_${Math.random().toString(36).slice(2, 10)}`,
        type: 'function',
        function: {
          name: block.name || '',
          arguments: JSON.stringify(block.input || {}),
        },
      });
    }
  }

  return {
    content: textContent || null,
    tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
    usage: response.usage ? {
      prompt_tokens: response.usage.input_tokens,
      completion_tokens: response.usage.output_tokens,
      total_tokens: response.usage.input_tokens + response.usage.output_tokens,
    } : undefined,
  };
}
