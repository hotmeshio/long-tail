import { executeLT } from '../../../orchestrator';
import type { LTEnvelope } from '../../../types';

/**
 * Orchestrator for the MCP triage workflow.
 *
 * Two-phase container:
 *
 * **Phase 1 — Triage analysis** (`mcpTriage` leaf via `executeLT`):
 *   The leaf queries upstream tasks and escalation history, reads the
 *   resolver's hints, and either applies a fix automatically (translate,
 *   rotate) or escalates to an engineer for guidance. If the leaf
 *   escalates, the orchestrator waits — the engineer resolves, the leaf
 *   re-runs with the response, applies the guided fix, and signals back.
 *   Either way, the orchestrator receives corrected data.
 *
 * **Phase 2 — Re-invocation** (original workflow via `executeLT`):
 *   The orchestrator re-invokes the original workflow with the corrected
 *   inputs. If it succeeds, the container interceptor signals back to
 *   the original parent orchestrator. The parent's `waitFor` resolves
 *   and the deterministic pipeline completes as if nothing went wrong.
 *
 * This is the "vortex" pattern: a completely separate remediation
 * orchestration runs independently while the parent stays alive on
 * `waitFor`. Signals — not child workflows — maintain the continuity.
 */
export async function mcpTriageOrchestrator(envelope: LTEnvelope) {
  const {
    originId,
    originalWorkflowType,
    originalTaskQueue,
  } = envelope.data;

  // Phase 1: Run the triage leaf — it returns corrected data or
  //          escalates to engineer (orchestrator waits via waitFor)
  const triageResult = await executeLT({
    workflowName: 'mcpTriage',
    args: [envelope],
    taskQueue: 'lt-mcp-triage',
    originId,
  });

  // Phase 2: Re-invoke the original workflow with the corrected data
  const correctedData = (triageResult as any)?.data?.correctedData;

  if (correctedData && originalWorkflowType && originalTaskQueue) {
    const result = await executeLT({
      workflowName: originalWorkflowType,
      args: [{
        data: correctedData,
        metadata: envelope.metadata || {},
      }],
      taskQueue: originalTaskQueue,
      originId,
    });

    // Return the merged result — container interceptor signals parent
    return {
      type: 'return',
      data: {
        ...(result as any)?.data,
        triaged: true,
        triageResult: (triageResult as any)?.data,
      },
      milestones: [
        ...((triageResult as any)?.milestones || []),
        ...((result as any)?.milestones || []),
      ],
    };
  }

  // No re-invocation needed — return triage result directly
  return triageResult;
}
