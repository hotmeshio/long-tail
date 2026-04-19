import { callLLM as callLLMService, type LLMResponse } from '../../../../services/llm';
import { LLM_MODEL_PRIMARY } from '../../../../modules/defaults';
import { loggerRegistry } from '../../../../lib/logger';

/**
 * Call the LLM for workflow building.
 *
 * Uses a higher max_tokens than the shared caller because the builder
 * returns complete YAML + manifest JSON (typically 2000-4000 tokens).
 */
const BUILDER_MAX_TOKENS = 4096;

export async function callBuilderLLM(
  messages: any[],
  _toolIds?: string[],
): Promise<LLMResponse> {
  const t0 = Date.now();
  const response = await callLLMService({
    model: LLM_MODEL_PRIMARY,
    messages,
    temperature: 0,
    max_tokens: BUILDER_MAX_TOKENS,
  });
  const usage = response.usage;
  loggerRegistry.info(
    `[workflowBuilder:callLLM] ${Date.now() - t0}ms | in=${usage?.prompt_tokens} out=${usage?.completion_tokens} total=${usage?.total_tokens} | tool_calls=${response.tool_calls?.length || 0}`,
  );
  return response;
}
