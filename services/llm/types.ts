/**
 * Model-agnostic LLM types.
 *
 * Uses OpenAI's message format as the canonical representation.
 * All providers translate to/from this format internally.
 */

// ── Message types ─────────────────────────────────────────────────────────────

export interface TextContent {
  type: 'text';
  text: string;
}

export interface ImageUrlContent {
  type: 'image_url';
  image_url: { url: string; detail?: 'auto' | 'low' | 'high' };
}

export type ContentPart = TextContent | ImageUrlContent;

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | ContentPart[] | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
}

// ── Tool types ────────────────────────────────────────────────────────────────

export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

// ── Request / Response ────────────────────────────────────────────────────────

export interface LLMOptions {
  model: string;
  messages: ChatMessage[];
  tools?: ToolDefinition[];
  max_tokens?: number;
  temperature?: number;
  response_format?: { type: 'json_object' | 'text' };
}

export interface LLMResponse {
  content: string | null;
  tool_calls?: ToolCall[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

// ── Provider interface ────────────────────────────────────────────────────────

export interface LLMProvider {
  call(options: LLMOptions): Promise<LLMResponse>;
}

// ── Provider detection ────────────────────────────────────────────────────────

export type ProviderName = 'openai' | 'anthropic' | 'openai-compatible';
