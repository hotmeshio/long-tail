/**
 * Anthropic provider — translates OpenAI canonical format to Anthropic's API.
 */

import type { LLMOptions, LLMResponse, LLMProvider } from '../types';
import {
  translateMessagesToAnthropic,
  translateToolsToAnthropic,
  translateAnthropicResponse,
} from '../translate';

const DEFAULT_MAX_TOKENS = 4096;

export class AnthropicProvider implements LLMProvider {
  private clientPromise: Promise<any> | null = null;
  private apiKey: string;

  constructor(apiKey?: string) {
    this.apiKey = apiKey || process.env.ANTHROPIC_API_KEY || '';
    if (!this.apiKey) {
      throw new Error(
        'ANTHROPIC_API_KEY is required for Claude models. ' +
        'Set it in your environment or .env file.',
      );
    }
  }

  private async getClient(): Promise<any> {
    if (!this.clientPromise) {
      this.clientPromise = import('@anthropic-ai/sdk').then(
        (mod) => new mod.default({ apiKey: this.apiKey }),
      );
    }
    return this.clientPromise;
  }

  async call(options: LLMOptions): Promise<LLMResponse> {
    const client = await this.getClient();

    // Translate messages from OpenAI canonical to Anthropic format
    const { system, messages } = translateMessagesToAnthropic(options.messages);

    // Build system prompt — append JSON mode instruction if needed
    let systemPrompt = system;
    if (options.response_format?.type === 'json_object') {
      const jsonInstruction = '\n\nYou must respond with valid JSON only. No markdown fences, no explanation, just the JSON object.';
      systemPrompt = systemPrompt ? systemPrompt + jsonInstruction : jsonInstruction.trim();
    }

    // Anthropic requires max_tokens
    const maxTokens = options.max_tokens || DEFAULT_MAX_TOKENS;

    // Build request
    const request: Record<string, unknown> = {
      model: options.model,
      max_tokens: maxTokens,
      messages,
      ...(systemPrompt ? { system: systemPrompt } : {}),
      ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
    };

    // Translate tools
    if (options.tools?.length) {
      request.tools = translateToolsToAnthropic(options.tools);
    }

    const response = await client.messages.create(request);
    return translateAnthropicResponse(response);
  }
}
