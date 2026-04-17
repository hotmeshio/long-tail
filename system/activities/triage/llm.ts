import type { LLMResponse } from '../../../services/llm';
import { callWorkflowLLM } from '../../workflows/shared/llm-caller';
import { toolDefCache } from './cache';

export async function callTriageLLM(
  messages: any[],
  toolIds?: string[],
): Promise<LLMResponse> {
  return callWorkflowLLM(messages, toolIds, toolDefCache, 'mcpTriage');
}
