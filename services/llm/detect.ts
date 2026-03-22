/**
 * Provider detection from model name strings.
 */

export type ProviderName = 'openai' | 'anthropic' | 'openai-compatible';

/**
 * Detect the LLM provider from a model name string.
 *
 * - gpt-*, o1-*, o3-*, o4-*, chatgpt-* → openai
 * - claude-* → anthropic
 * - everything else → openai-compatible (Groq, Together, local, etc.)
 */
export function detectProvider(model: string): ProviderName {
  if (/^(gpt-|o1-|o3-|o4-|chatgpt-)/.test(model)) return 'openai';
  if (/^claude-/.test(model)) return 'anthropic';
  return 'openai-compatible';
}

/**
 * Resolve the API key for a given provider.
 */
export function resolveApiKey(provider: ProviderName): string | undefined {
  switch (provider) {
    case 'openai':
    case 'openai-compatible':
      return process.env.LT_LLM_API_KEY || process.env.OPENAI_API_KEY;
    case 'anthropic':
      return process.env.ANTHROPIC_API_KEY;
  }
}
