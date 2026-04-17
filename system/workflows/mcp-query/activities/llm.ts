import type { LLMResponse } from '../../../../services/llm';
import { callWorkflowLLM } from '../../shared/llm-caller';
import { toolDefCache } from './caches';

export async function callQueryLLM(
  messages: any[],
  toolIds?: string[],
): Promise<LLMResponse> {
  return callWorkflowLLM(messages, toolIds, toolDefCache, 'mcpQuery');
}
