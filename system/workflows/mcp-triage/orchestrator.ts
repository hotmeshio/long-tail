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
 * workflow pipeline. It NEVER signals the original parent directly.
 * Instead, it exits via one of two paths:
 *
 * **Direct resolution** (simple approval/rejection/pass-through):
 *   The LLM recognizes unambiguous human intent (e.g., "I approve")
 *   and sets `directResolution: true`. The orchestrator directly
 *   starts a re-run of the original workflow with the corrected data
 *   as `envelope.resolver`, bypassing the escalation cycle entirely.
 *   The standard interceptor handles everything from there.
 *
 * **Escalation** (tool-assisted fix or failure):
 *   Creates a targeted escalation on the ORIGINAL task with the
 *   triage results. A human reviews and resolves that escalation,
 *   which triggers the standard re-run flow.
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
    ltStartWorkflow,
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
  const directResolution = triageData?.directResolution === true;

  // Phase 2: Exit the vortex.

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

    // Extract routing metadata once — used by both resolution paths
    // to ensure the interceptor finds the EXISTING task and can
    // signal the parent orchestrator on completion.
    const originalMeta = originalTask?.metadata as Record<string, any> | null;

    // Enrich the envelope with full routing context. Both paths
    // (direct resolution and escalation) need this so re-runs
    // find the original task instead of creating orphan tasks.
    originalEnvelope.lt = {
      ...originalEnvelope.lt,
      taskId: originalTaskId,
      originId,
      parentId: originalTask?.parent_id || originalEnvelope.lt?.parentId,
      signalId: originalMeta?.signalId,
      parentWorkflowId: originalMeta?.parentWorkflowId,
      parentTaskQueue: originalMeta?.parentTaskQueue,
      parentWorkflowType: originalMeta?.parentWorkflowType,
    };

    // ── Direct resolution: simple approval/rejection/pass-through ──
    // Bypass escalation cycle — directly re-run the original workflow
    // with correctedData as the resolver. The interceptor handles
    // task completion and parent signaling from there.
    if (directResolution && correctedData) {
      originalEnvelope.resolver = correctedData;
      originalEnvelope.lt = {
        ...originalEnvelope.lt,
        escalationId: envelope.data.escalationId,
        _triageDirect: true,
      };

      const rerunWorkflowId = `triage-rerun-${originalTaskId}-${Durable.guid()}`;
      await ltStartWorkflow({
        workflowName: originalWorkflowType,
        taskQueue: originalTaskQueue,
        workflowId: rerunWorkflowId,
        args: [originalEnvelope],
        expire: 180,
      });

      return {
        type: 'return',
        data: {
          triaged: true,
          exitedVortex: true,
          directResolution: true,
          targetedOriginalTask: originalTaskId,
          hasCorrectedData: true,
          rerunWorkflowId,
          triageResult: triageData,
        },
        milestones: [
          ...((triageResult as any)?.milestones || []),
          { name: 'vortex', value: 'direct_resolution' },
        ],
      };
    }

    // ── Escalation path: tool-assisted fix or triage failure ──
    // Create a targeted escalation on the original task so a human
    // can review the corrected data (or triage failure) before it
    // goes back to the original workflow. The envelope was already
    // enriched with routing context above.
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
      directResolution: false,
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
