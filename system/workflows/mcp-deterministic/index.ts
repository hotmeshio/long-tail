import { Durable } from '@hotmeshio/hotmesh';

import type { LTEnvelope, LTReturn } from '../../../types';
import * as activities from './activities';

type ActivitiesType = typeof activities;

const { invokeCompiledWorkflow } = Durable.workflow.proxyActivities<ActivitiesType>({
  activities,
  retry: {
    maximumAttempts: 3,
    backoffCoefficient: 2,
    maximumInterval: '10 seconds',
  },
});

/**
 * MCP Deterministic workflow (leaf).
 *
 * Invokes a matched compiled YAML workflow with explicit inputs.
 * Called by mcpQueryRouter when a compiled workflow matches
 * the user's prompt with high confidence.
 */
export async function mcpDeterministic(
  envelope: LTEnvelope,
): Promise<LTReturn> {
  const { workflowName, inputs, confidence } = envelope.data as {
    workflowName: string;
    inputs: Record<string, any>;
    confidence: number;
  };

  const result = await invokeCompiledWorkflow(workflowName, inputs);

  return {
    type: 'return',
    data: {
      title: `Executed: ${workflowName}`,
      summary: `Matched compiled workflow with ${(confidence * 100).toFixed(0)}% confidence. Deterministic execution completed.`,
      result,
      tool_calls_made: 1,
      discovery: { method: 'compiled-workflow', confidence, workflowName },
    },
    milestones: [
      { name: 'mcp_query', value: 'completed' },
      { name: 'discovery', value: 'compiled_match' },
      { name: 'confidence', value: String(confidence) },
    ],
  };
}
