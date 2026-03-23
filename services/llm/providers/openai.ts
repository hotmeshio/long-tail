/**
 * OpenAI provider — thin wrapper since our canonical format matches OpenAI's.
 */

import OpenAI from 'openai';

import type { LLMOptions, LLMResponse, LLMProvider } from '../types';

export class OpenAIProvider implements LLMProvider {
  private client: OpenAI;

  constructor(apiKey?: string, baseURL?: string) {
    this.client = new OpenAI({
      apiKey: apiKey || process.env.OPENAI_API_KEY,
      ...(baseURL ? { baseURL } : {}),
    });
  }

  async call(options: LLMOptions): Promise<LLMResponse> {
    const response = await this.client.chat.completions.create({
      model: options.model,
      messages: options.messages as any,
      ...(options.tools?.length ? { tools: options.tools as any } : {}),
      ...(options.max_tokens !== undefined ? { max_tokens: options.max_tokens } : {}),
      ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
      ...(options.response_format ? { response_format: options.response_format } : {}),
    });

    const choice = response.choices[0]?.message;
    if (!choice) {
      return { content: null, tool_calls: undefined, usage: undefined };
    }

    return {
      content: choice.content ?? null,
      tool_calls: choice.tool_calls?.map((tc: any) => ({
        id: tc.id,
        type: 'function' as const,
        function: { name: tc.function.name, arguments: tc.function.arguments },
      })),
      usage: response.usage ? {
        prompt_tokens: response.usage.prompt_tokens,
        completion_tokens: response.usage.completion_tokens,
        total_tokens: response.usage.total_tokens,
      } : undefined,
    };
  }
}
