import { executeLT } from '../../orchestrator';
import type { LTEnvelope } from '../../types';

/**
 * Orchestrator for the MCP triage workflow.
 *
 * Thin container that calls `executeLT` to start the triage child.
 * The LT interceptor creates the task record, manages the signal
 * back to the original parent orchestrator, and tracks the full
 * triage lifecycle in the audit trail.
 *
 * This workflow is always registered when the MCP escalation strategy
 * is enabled. It is never called directly — the resolution route
 * starts it when a resolver flags `needsTriage`.
 */
export async function mcpTriageOrchestrator(envelope: LTEnvelope) {
  return await executeLT({
    workflowName: 'mcpTriage',
    args: [envelope],
    taskQueue: 'lt-mcp-triage',
    originId: envelope.data.originId,
  });
}
