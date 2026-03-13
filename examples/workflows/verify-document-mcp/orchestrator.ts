import { executeLT } from '../../../services/orchestrator';
import type { LTEnvelope } from '../../../types';

/**
 * Orchestrator for the MCP-native verifyDocument workflow.
 *
 * This thin wrapper calls `executeLT` which implicitly creates a task
 * record, executes the child workflow, and completes the task.
 * The LT interceptor handles escalation if document verification
 * encounters a mismatch or extraction failure.
 */
export async function verifyDocumentMcpOrchestrator(envelope: LTEnvelope) {
  return await executeLT({
    workflowName: 'verifyDocumentMcp',
    args: [envelope],
    taskQueue: 'long-tail-verify-mcp',
  });
}
