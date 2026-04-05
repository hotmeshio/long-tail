import { Durable } from '@hotmeshio/hotmesh';

import type { LTEnvelope, LTReturn } from '../../../types';
import type { TriageResponseDeps, TriageContext } from './types';
import {
  buildMilestones,
  buildDirectResolutionReturn,
  buildVortexUnwoundReturn,
  buildUnresolvedReturn,
  parseTriageResponse,
} from './response-builders';

// Re-export public API so existing consumers are unaffected
export { parseTriageResponse, stripJsonComments } from './response-builders';

// ── Main handler ──────────────────────────────────────────────

/**
 * Process the LLM's final response and route corrected data
 * back to the original workflow through the appropriate exit path.
 */
export async function handleFinalResponse(
  content: string,
  envelope: LTEnvelope,
  toolCallCount: number,
  deps: TriageResponseDeps,
): Promise<LTReturn> {
  const parsed = parseTriageResponse(content);
  const ctx = extractTriageContext(envelope);
  const milestones = buildMilestones(toolCallCount);

  // 1. LLM couldn't fix — return failure so the parent router gets signaled
  if (!parsed.correctedData) {
    return buildUnresolvedReturn(ctx, parsed, toolCallCount);
  }

  // 2. Notify engineering if the LLM has a recommendation
  if (parsed.recommendation) {
    await notifyEngineeringOfFix(deps, ctx, parsed, toolCallCount);
  }

  // 3. Merge corrected data with original escalation payload
  const correctedData = mergeCorrectedData(ctx.escalationPayload, parsed.correctedData);

  // 4. Exit the vortex — route fix back to the original workflow
  if (ctx.originalWorkflowType && ctx.originalTaskQueue && ctx.originalTaskId) {
    const originalEnvelope = await reconstructOriginalEnvelope(deps, ctx);

    if (parsed.directResolution) {
      // 4a. Direct resolution — re-run original workflow immediately
      const rerunId = await rerunOriginalWorkflow(deps, ctx, originalEnvelope, correctedData, parsed, toolCallCount);
      return buildDirectResolutionReturn(ctx, parsed, correctedData, rerunId, toolCallCount, milestones);
    }

    // 4b. Escalation path — create follow-up for human review
    await createReviewEscalation(deps, ctx, originalEnvelope, correctedData, parsed, toolCallCount);
  }

  // 5. Return success — vortex unwound
  return buildVortexUnwoundReturn(ctx, parsed, correctedData, toolCallCount, milestones);
}

// ── Context extraction ────────────────────────────────────────

function extractTriageContext(envelope: LTEnvelope): TriageContext {
  return {
    originId: envelope.data.originId,
    originalWorkflowType: envelope.data.originalWorkflowType,
    originalTaskQueue: envelope.data.originalTaskQueue,
    originalTaskId: envelope.data.originalTaskId,
    escalationPayload: envelope.data.escalationPayload || {},
    escalationId: envelope.data.escalationId,
    parentId: envelope.lt?.parentId,
  };
}

function mergeCorrectedData(
  escalationPayload: Record<string, any>,
  correctedData: Record<string, any>,
): Record<string, any> {
  const merged = { ...escalationPayload, ...correctedData };
  delete merged._lt;
  return merged;
}

// ── Envelope reconstruction ───────────────────────────────────

async function reconstructOriginalEnvelope(
  deps: TriageResponseDeps,
  ctx: TriageContext,
): Promise<Record<string, any>> {
  const originalTask = await deps.ltGetTask(ctx.originalTaskId!);

  let envelope: Record<string, any> = {};
  if (originalTask?.envelope) {
    try { envelope = JSON.parse(originalTask.envelope); } catch { /* use empty */ }
  }

  const meta = originalTask?.metadata as Record<string, any> | null;
  envelope.lt = {
    ...envelope.lt,
    taskId: ctx.originalTaskId,
    originId: ctx.originId,
    parentId: originalTask?.parent_id || envelope.lt?.parentId,
    signalId: meta?.signalId,
    parentWorkflowId: meta?.parentWorkflowId,
    parentTaskQueue: meta?.parentTaskQueue,
    parentWorkflowType: meta?.parentWorkflowType,
  };

  // Strip triage flags so follow-on resolution doesn't re-trigger mcpTriage
  if (envelope.data?._lt) {
    delete envelope.data._lt;
  }

  return envelope;
}

// ── Vortex exit paths ─────────────────────────────────────────

async function rerunOriginalWorkflow(
  deps: TriageResponseDeps,
  ctx: TriageContext,
  originalEnvelope: Record<string, any>,
  correctedData: Record<string, any>,
  triageParsed: Record<string, any>,
  toolCallCount: number,
): Promise<string> {
  originalEnvelope.resolver = {
    ...correctedData,
    _triageContext: {
      diagnosis: triageParsed.diagnosis,
      actions_taken: triageParsed.actions_taken,
      recommendation: triageParsed.recommendation,
      confidence: triageParsed.confidence,
      tool_calls_made: toolCallCount,
    },
  };
  originalEnvelope.lt = {
    ...originalEnvelope.lt,
    escalationId: ctx.escalationId,
    _triageDirect: true,
  };

  const rerunId = `triage-rerun-${ctx.originalTaskId}-${Durable.guid()}`;

  // Create a task record so the re-run is visible in the wizard
  await deps.ltCreateTask({
    workflowId: rerunId,
    workflowType: ctx.originalWorkflowType,
    ltType: ctx.originalWorkflowType,
    taskQueue: ctx.originalTaskQueue,
    signalId: `lt-${rerunId}`,
    parentWorkflowId: rerunId,
    originId: ctx.originId,
    envelope: JSON.stringify(originalEnvelope),
  });

  await deps.ltStartWorkflow({
    workflowName: ctx.originalWorkflowType,
    taskQueue: ctx.originalTaskQueue,
    workflowId: rerunId,
    args: [originalEnvelope],
    expire: 180,
  });
  return rerunId;
}

async function createReviewEscalation(
  deps: TriageResponseDeps,
  ctx: TriageContext,
  originalEnvelope: Record<string, any>,
  correctedData: Record<string, any>,
  parsed: Record<string, any>,
  toolCallCount: number,
): Promise<void> {
  const originalTask = await deps.ltGetTask(ctx.originalTaskId!);
  const wfConfig = await deps.ltGetWorkflowConfig(ctx.originalWorkflowType);

  await deps.ltCreateEscalation({
    type: ctx.originalWorkflowType,
    subtype: ctx.originalWorkflowType,
    description: 'AI Triage — Ready for Review',
    priority: 3,
    taskId: ctx.originalTaskId,
    originId: ctx.originId,
    parentId: ctx.parentId,
    role: wfConfig?.role || 'reviewer',
    envelope: JSON.stringify(originalEnvelope),
    escalationPayload: JSON.stringify({
      ...correctedData,
      _triage: {
        diagnosis: parsed.diagnosis,
        actions_taken: parsed.actions_taken,
        tool_calls_made: toolCallCount,
        confidence: parsed.confidence,
        recommendation: parsed.recommendation,
        originalData: ctx.escalationPayload,
      },
    }),
    workflowId: originalTask?.workflow_id,
    workflowType: ctx.originalWorkflowType,
    taskQueue: ctx.originalTaskQueue,
  });
}

async function notifyEngineeringOfFix(
  deps: TriageResponseDeps,
  ctx: TriageContext,
  parsed: Record<string, any>,
  toolCallCount: number,
): Promise<void> {
  await deps.notifyEngineering(
    ctx.originId,
    `Triage auto-remediation for ${ctx.originalWorkflowType}: ${parsed.diagnosis || 'issue resolved'}. Recommendation: ${parsed.recommendation}`,
    { actions_taken: parsed.actions_taken, tool_calls: toolCallCount, confidence: parsed.confidence },
  );
}
