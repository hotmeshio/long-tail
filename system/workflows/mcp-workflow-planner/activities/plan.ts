/**
 * Generate a decomposition plan from a specification using an LLM.
 */

import type { PlanItem } from '../../../../types/workflow-set';
import { callLLM } from '../../../../services/llm';
import { LLM_MODEL_PRIMARY } from '../../../../modules/defaults';
import { PLANNER_SYSTEM_PROMPT } from '../prompts';

export interface PlanResult {
  plan_name: string;
  plan_description: string;
  workflows: PlanItem[];
}

export async function generatePlan(
  specification: string,
): Promise<PlanResult> {
  const response = await callLLM({
    model: LLM_MODEL_PRIMARY,
    max_tokens: 4096,
    temperature: 0,
    messages: [
      { role: 'system', content: PLANNER_SYSTEM_PROMPT },
      { role: 'user', content: specification },
    ],
  });

  const raw = response.content || '{}';
  const cleaned = raw.replace(/^```(?:json)?\s*/m, '').replace(/\s*```$/m, '').trim();
  const parsed = JSON.parse(cleaned) as PlanResult;

  if (!Array.isArray(parsed.workflows) || parsed.workflows.length === 0) {
    throw new Error('Planner produced empty workflow list');
  }

  // Sort by build_order (leaf-first)
  parsed.workflows.sort((a, b) => a.build_order - b.build_order);

  // Extract unique namespaces
  const namespaces = [...new Set(parsed.workflows.map(w => w.namespace))];

  return {
    plan_name: parsed.plan_name || 'unnamed-plan',
    plan_description: parsed.plan_description || '',
    workflows: parsed.workflows.map(w => ({
      name: w.name,
      description: w.description,
      namespace: w.namespace,
      role: w.role || 'leaf',
      dependencies: w.dependencies || [],
      build_order: w.build_order ?? 0,
      io_contract: w.io_contract || { input_schema: {}, output_schema: {} },
    })),
  };
}
