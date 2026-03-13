import { Durable } from '@hotmeshio/hotmesh';

import { executeLT } from '../../../services/orchestrator';
import * as interceptorActivities from '../../../services/interceptor/activities';
import type { LTEnvelope } from '../../../types';

type ActivitiesType = typeof interceptorActivities;

const LT_ACTIVITY_QUEUE = 'lt-interceptor';

/**
 * Orchestrator for the MCP triage workflow.
 *
 * The triage vortex exists on a **separate axis** from the original
 * workflow pipeline. It NEVER signals the original parent or creates
 * new tasks for the original workflow. Instead, it:
 *
 * 1. Runs the triage leaf (which may use MCP tools, escalate to
 *    engineers, etc.)
 * 2. Creates a targeted escalation on the ORIGINAL task with the
 *    triage results (translated content, corrected data, etc.)
 * 3. Completes itself — vortex unwound.
 *
 * The original task remains `needs_intervention`. The new escalation
 * carries proper routing (workflowType, taskQueue, envelope) so that
 * when a human resolves it, the standard re-run flow handles
 * everything: starts a new instance of the original workflow with
 * `envelope.resolver`, which signals the parent orchestrator.
 */
export async function mcpTriageOrchestrator(envelope: LTEnvelope) {
  const {
    originId,
    originalWorkflowType,
    originalTaskQueue,
    originalTaskId,
  } = envelope.data;

  const {
    ltCreateEscalation,
    ltGetTask,
    ltGetWorkflowConfig,
  } = Durable.workflow.proxyActivities<ActivitiesType>({
    activities: interceptorActivities,
    taskQueue: LT_ACTIVITY_QUEUE,
    retryPolicy: { maximumAttempts: 3 },
  });

  // Phase 1: Run the triage leaf — it returns corrected data or
  //          escalates to engineer (orchestrator waits via waitFor)
  const triageResult = await executeLT({
    workflowName: 'mcpTriage',
    args: [envelope],
    taskQueue: 'lt-mcp-triage',
    originId,
  });

  const triageData = (triageResult as any)?.data;
  const correctedData = triageData?.correctedData;

  // Phase 2: Exit the vortex.
  //
  // Always create a targeted escalation on the original task so a
  // human can review the corrected data (or triage failure) before
  // it goes back to the original workflow. The human who flagged
  // triage should see the result and act on it judiciously — the
  // standard resolver form lets them submit the final resolution.

  if (originalWorkflowType && originalTaskQueue && originalTaskId) {
    const originalTask = await ltGetTask(originalTaskId);
    const originalWfConfig = await ltGetWorkflowConfig(originalWorkflowType);

    // Reconstruct the original envelope from the task record
    let originalEnvelope: Record<string, any> = {};
    if (originalTask?.envelope) {
      try {
        originalEnvelope = JSON.parse(originalTask.envelope);
      } catch { /* use empty */ }
    }

    const escalationPayload: Record<string, any> = correctedData
      ? {
          ...correctedData,
          _triage: {
            diagnosis: triageData?.diagnosis,
            actions_taken: triageData?.actions_taken,
            tool_calls_made: triageData?.tool_calls_made,
            confidence: triageData?.confidence,
            recommendation: triageData?.recommendation,
            originalData: envelope.data.escalationPayload || {},
          },
        }
      : {
          ...(envelope.data.escalationPayload || {}),
          _triage: {
            diagnosis: triageData?.diagnosis,
            actions_taken: triageData?.actions_taken,
            tool_calls_made: triageData?.tool_calls_made,
            confidence: triageData?.confidence,
            recommendation: triageData?.recommendation,
          },
        };

    const description = correctedData
      ? `AI Triage — Ready for Review`
      : `AI Triage — Needs Attention`;

    await ltCreateEscalation({
      type: originalWorkflowType,
      subtype: originalWorkflowType,
      modality: originalWfConfig?.modality || 'default',
      description,
      priority: correctedData ? 3 : 2,
      taskId: originalTaskId,
      originId,
      parentId: envelope.lt?.parentId,
      role: correctedData
        ? (originalWfConfig?.role || 'reviewer')
        : 'engineer',
      envelope: JSON.stringify(originalEnvelope),
      escalationPayload: JSON.stringify(escalationPayload),
      workflowId: originalTask?.workflow_id,
      workflowType: originalWorkflowType,
      taskQueue: originalTaskQueue,
    });
  }

  // Vortex complete — triage orchestrator returns successfully.
  // The container interceptor will complete the triage task but
  // will NOT signal the original parent (routing was stripped).
  return {
    type: 'return',
    data: {
      triaged: true,
      exitedVortex: true,
      targetedOriginalTask: originalTaskId || null,
      hasCorrectedData: !!correctedData,
      triageResult: triageData,
    },
    milestones: [
      ...((triageResult as any)?.milestones || []),
      { name: 'vortex', value: 'unwound' },
    ],
  };
}
