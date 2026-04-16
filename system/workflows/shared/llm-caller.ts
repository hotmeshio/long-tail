import { callLLM as callLLMService, type ToolDefinition, type LLMResponse } from '../../../services/llm';
import { LLM_MODEL_PRIMARY, LLM_MAX_TOKENS_DEFAULT } from '../../../modules/defaults';
import { loggerRegistry } from '../../../services/logger';

/**
 * Call the LLM with messages and optional tool IDs.
 *
 * Tool IDs are resolved from the caller's module-level toolDefCache so
 * that only lightweight string arrays flow through the durable pipe.
 */
export async function callWorkflowLLM(
  messages: any[],
  toolIds: string[] | undefined,
  toolDefCache: Map<string, ToolDefinition>,
  logPrefix: string,
): Promise<LLMResponse> {
  let tools: ToolDefinition[] | undefined;
  if (toolIds?.length) {
    tools = toolIds
      .map((id) => toolDefCache.get(id))
      .filter((t): t is ToolDefinition => !!t);
  }

  const t0 = Date.now();
  const response = await callLLMService({
    model: LLM_MODEL_PRIMARY,
    messages,
    temperature: 0,
    ...(tools?.length ? { tools } : {}),
    ...(!tools?.length ? { max_tokens: LLM_MAX_TOKENS_DEFAULT } : {}),
  });
  const usage = response.usage;
  loggerRegistry.info(
    `[${logPrefix}:callLLM] ${Date.now() - t0}ms | in=${usage?.prompt_tokens} out=${usage?.completion_tokens} total=${usage?.total_tokens} | tool_calls=${response.tool_calls?.length || 0}`,
  );
  return response;
}
