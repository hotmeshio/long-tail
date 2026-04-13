import { Durable } from '@hotmeshio/hotmesh';

import { executeLT } from '../../../services/orchestrator';
import type { LTEnvelope, LTReturn } from '../../../types';
import * as activities from './activities';

type ActivitiesType = typeof activities;

const {
  findTriageWorkflows,
  evaluateTriageMatch,
  extractTriageInputs,
} = Durable.workflow.proxyActivities<ActivitiesType>({
  activities,
  retry: {
    maximumAttempts: 3,
    backoffCoefficient: 2,
    maximumInterval: '10 seconds',
  },
});

/**
 * MCP Triage Router (orchestrator/container).
 *
 * Entry point for triage requests. Determines whether a compiled
 * deterministic workflow can handle the triage issue or whether
 * dynamic MCP orchestration is needed.
 *
 * Phase 1: FTS + tag discovery of compiled workflows
 * Phase 2: LLM-as-judge matching + input extraction
 * Route: mcpTriageDeterministic (compiled match) OR mcpTriage (dynamic)
 */
export async function mcpTriageRouter(
  envelope: LTEnvelope,
): Promise<LTReturn> {
  const {
    originalWorkflowType,
    escalationPayload,
    resolverPayload,
  } = envelope.data;

  // Build a search prompt from the triage context for compiled workflow discovery
  const resolverNotes = resolverPayload?.notes || resolverPayload?._lt?.notes || '';
  const escalationDescription = typeof escalationPayload === 'object'
    ? (escalationPayload.description || escalationPayload.message || '')
    : '';
  const searchPrompt = [
    originalWorkflowType,
    resolverNotes,
    escalationDescription,
  ].filter(Boolean).join(' — ');

  if (!searchPrompt) {
    // No context to search — go straight to dynamic triage
    return await executeLT<LTReturn>({
      workflowName: 'mcpTriage',
      args: [envelope],
      taskQueue: 'long-tail-system',
    });
  }

  // Phase 1: Ranked discovery of compiled YAML workflows
  const compiled = await findTriageWorkflows(searchPrompt);

  // Phase 2: LLM-as-judge — does a compiled workflow match?
  if (compiled.candidates.length > 0) {
    const match = await evaluateTriageMatch(searchPrompt, compiled.candidates);

    if (match.matched && match.workflowName) {
      // Phase 2b: Extract structured inputs from the FULL triage context
      // (not just the search prompt — include the actual escalation data
      // so the LLM can map real values like content text to the schema)
      const candidate = compiled.candidates.find((c) => c.name === match.workflowName);
      const inputSchema = candidate?.input_schema || { type: 'object', properties: {} };
      const extractionContext = [
        searchPrompt,
        escalationPayload ? `\n## Escalation Data\n${JSON.stringify(escalationPayload, null, 2)}` : '',
        resolverPayload ? `\n## Resolver Notes\n${JSON.stringify(resolverPayload, null, 2)}` : '',
      ].filter(Boolean).join('\n');
      const extraction = await extractTriageInputs(extractionContext, inputSchema, match.workflowName);

      if (extraction.extracted && extraction.inputs) {
        // Route to mcpTriageDeterministic — compiled workflow handles this
        return await executeLT<LTReturn>({
          workflowName: 'mcpTriageDeterministic',
          args: [{
            data: {
              ...envelope.data,
              workflowName: match.workflowName,
              inputs: extraction.inputs,
              confidence: match.confidence,
            },
            metadata: envelope.metadata,
            lt: envelope.lt,
          }],
          taskQueue: 'long-tail-system',
        });
      }
      // Input extraction failed — fall through to dynamic
    }
  }

  // No compiled match — route to mcpTriage for dynamic MCP orchestration
  return await executeLT<LTReturn>({
    workflowName: 'mcpTriage',
    args: [envelope],
    taskQueue: 'long-tail-system',
  });
}
