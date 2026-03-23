import { Durable } from '@hotmeshio/hotmesh';

import { executeLT } from '../../../services/orchestrator';
import type { LTEnvelope, LTReturn, LTEscalation } from '../../../types';
import * as activities from './activities';

type ActivitiesType = typeof activities;

const {
  findCompiledWorkflows,
  evaluateWorkflowMatch,
  extractWorkflowInputs,
} = Durable.workflow.proxyActivities<ActivitiesType>({
  activities,
  retryPolicy: {
    maximumAttempts: 3,
    backoffCoefficient: 2,
    maximumInterval: '10 seconds',
  },
});

/**
 * MCP Query Router (orchestrator/container).
 *
 * Entry point for all MCP queries. Determines whether a compiled
 * deterministic YAML workflow can handle the request or whether
 * dynamic MCP orchestration is needed.
 *
 * Phase 1: FTS + tag discovery of compiled workflows
 * Phase 2: LLM-as-judge matching + input extraction
 * Route: mcpDeterministic (compiled match) OR mcpQuery (dynamic)
 */
export async function mcpQueryRouter(
  envelope: LTEnvelope,
): Promise<LTReturn | LTEscalation> {
  const prompt = (envelope.data?.prompt || envelope.data?.question) as string;
  const tags = envelope.data?.tags as string[] | undefined;

  if (!prompt) {
    return {
      type: 'return',
      data: {
        title: 'No prompt provided',
        summary: 'Please provide a prompt describing what you want to accomplish.',
        result: null,
        tool_calls_made: 0,
      },
    };
  }

  // Phase 1: Ranked discovery of compiled YAML workflows
  const compiled = await findCompiledWorkflows(prompt);

  // Phase 2: LLM-as-judge — does a compiled workflow match?
  if (compiled.candidates.length > 0) {
    const match = await evaluateWorkflowMatch(prompt, compiled.candidates);

    if (match.matched && match.workflowName) {
      // Phase 2b: Extract structured inputs from the prompt
      const candidate = compiled.candidates.find((c) => c.name === match.workflowName);
      const inputSchema = candidate?.input_schema || { type: 'object', properties: {} };
      const extraction = await extractWorkflowInputs(prompt, inputSchema, match.workflowName);

      if (extraction.extracted && extraction.inputs) {
        // Route to mcpDeterministic — compiled workflow handles this
        return await executeLT<LTReturn>({
          workflowName: 'mcpDeterministic',
          args: [{
            data: {
              workflowName: match.workflowName,
              inputs: extraction.inputs,
              confidence: match.confidence,
            },
            metadata: envelope.metadata,
          }],
          taskQueue: 'long-tail-system',
        });
      }
      // Input extraction failed — fall through to dynamic
    }
  }

  // No compiled match — route to mcpQuery for dynamic MCP orchestration
  return await executeLT<LTReturn>({
    workflowName: 'mcpQuery',
    args: [{ data: { prompt, tags }, metadata: envelope.metadata }],
    taskQueue: 'long-tail-system',
  });
}
