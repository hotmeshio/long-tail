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
 * MCP Triage Deterministic workflow (leaf).
 *
 * Invokes a matched compiled YAML workflow for triage remediation.
 * Called by mcpTriageRouter when a compiled workflow matches
 * the triage context with high confidence.
 *
 * The result is wrapped as correctedData so the triage vortex exit
 * logic in mcpTriage can route it back to the original workflow.
 */
export async function mcpTriageDeterministic(
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
      triaged: true,
      exitedVortex: true,
      directResolution: true,
      correctedData: result?.result || result,
      originalWorkflowType: envelope.data.originalWorkflowType,
      originalTaskQueue: envelope.data.originalTaskQueue,
      originId: envelope.data.originId,
      diagnosis: `Matched compiled workflow "${workflowName}" with ${(confidence * 100).toFixed(0)}% confidence.`,
      actions_taken: [`Invoked compiled workflow: ${workflowName}`],
      tool_calls_made: 1,
      confidence,
      discovery: { method: 'compiled-workflow', confidence, workflowName },
    },
    milestones: [
      { name: 'triage', value: 'completed' },
      { name: 'triage_method', value: 'deterministic' },
      { name: 'discovery', value: 'compiled_match' },
      { name: 'confidence', value: String(confidence) },
    ],
  };
}
