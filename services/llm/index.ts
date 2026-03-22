/**
 * Model-agnostic LLM service.
 *
 * Single entry point for all LLM calls in the application.
 * Automatically detects the provider from the model name and
 * routes to the appropriate SDK (OpenAI, Anthropic, or any
 * OpenAI-compatible provider).
 *
 * Usage:
 *   import { callLLM, hasLLMApiKey } from '../services/llm';
 *   const response = await callLLM({ model, messages, tools, max_tokens });
 *   console.log(response.content, response.tool_calls);
 */

import { detectProvider, resolveApiKey, type ProviderName } from './detect';
import type { LLMOptions, LLMResponse, LLMProvider } from './types';

// Re-export types for call sites
export type {
  LLMOptions,
  LLMResponse,
  LLMProvider,
  ChatMessage,
  ToolDefinition,
  ToolCall,
  ContentPart,
  TextContent,
  ImageUrlContent,
} from './types';

export { detectProvider } from './detect';

// ── Provider cache (lazy singletons) ──────────────────────────────────────────

const providers = new Map<ProviderName, LLMProvider>();

async function getProvider(model: string): Promise<LLMProvider> {
  const name = detectProvider(model);
  let provider = providers.get(name);
  if (!provider) {
    const apiKey = resolveApiKey(name);
    switch (name) {
      case 'openai':
      case 'openai-compatible': {
        const { OpenAIProvider } = await import('./providers/openai');
        const baseURL = process.env.LT_LLM_BASE_URL;
        provider = new OpenAIProvider(apiKey, name === 'openai-compatible' ? baseURL : undefined);
        break;
      }
      case 'anthropic': {
        const { AnthropicProvider } = await import('./providers/anthropic');
        provider = new AnthropicProvider(apiKey);
        break;
      }
    }
    providers.set(name, provider!);
  }
  return provider!;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Call an LLM with model-agnostic options.
 *
 * The provider is auto-detected from the model name:
 * - gpt-*, o1-*, o3-*, o4-* → OpenAI
 * - claude-* → Anthropic
 * - others → OpenAI-compatible (respects LT_LLM_BASE_URL)
 *
 * Messages, tools, and responses use OpenAI's format as the canonical
 * representation. Translation to/from other providers happens internally.
 */
export async function callLLM(options: LLMOptions): Promise<LLMResponse> {
  const provider = await getProvider(options.model);
  return provider.call(options);
}

/**
 * Check if the required API key is available for a given model.
 * Useful for conditional feature enablement (e.g., skip LLM compilation
 * when no key is configured).
 */
export function hasLLMApiKey(model?: string): boolean {
  const m = model || process.env.LT_LLM_MODEL_PRIMARY || 'gpt-4o';
  const provider = detectProvider(m);
  const key = resolveApiKey(provider);
  return !!key && key !== 'xxx';
}
