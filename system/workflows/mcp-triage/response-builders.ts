import type { LTReturn } from '../../../types';
import type { TriageContext } from './types';

// ── Milestones ────────────────────────────────────────────────

export function buildMilestones(toolCallCount: number) {
  return [
    { name: 'triage', value: 'completed' },
    { name: 'triage_method', value: toolCallCount > 0 ? 'llm_with_tools' : 'llm_direct' },
    { name: 'tool_calls', value: String(toolCallCount) },
  ];
}

// ── Return builders ───────────────────────────────────────────

export function buildDirectResolutionReturn(
  ctx: TriageContext, parsed: Record<string, any>,
  correctedData: Record<string, any>, rerunId: string,
  toolCallCount: number, milestones: Array<{ name: string; value: string }>,
): LTReturn {
  return {
    type: 'return',
    data: {
      triaged: true, exitedVortex: true, directResolution: true,
      targetedOriginalTask: ctx.originalTaskId,
      hasCorrectedData: true, rerunWorkflowId: rerunId, correctedData,
      originalWorkflowType: ctx.originalWorkflowType,
      originalTaskQueue: ctx.originalTaskQueue,
      originId: ctx.originId,
      diagnosis: parsed.diagnosis, actions_taken: parsed.actions_taken,
      tool_calls_made: toolCallCount, confidence: parsed.confidence,
    },
    milestones: [...milestones, { name: 'vortex', value: 'direct_resolution' }],
  };
}

export function buildVortexUnwoundReturn(
  ctx: TriageContext, parsed: Record<string, any>,
  correctedData: Record<string, any>, toolCallCount: number,
  milestones: Array<{ name: string; value: string }>,
): LTReturn {
  return {
    type: 'return',
    data: {
      triaged: true, exitedVortex: true, directResolution: false,
      targetedOriginalTask: ctx.originalTaskId || null,
      hasCorrectedData: true, correctedData,
      originalWorkflowType: ctx.originalWorkflowType,
      originalTaskQueue: ctx.originalTaskQueue,
      originId: ctx.originId,
      diagnosis: parsed.diagnosis, actions_taken: parsed.actions_taken,
      tool_calls_made: toolCallCount, confidence: parsed.confidence,
    },
    milestones: [...milestones, { name: 'vortex', value: 'unwound' }],
  };
}

export function buildUnresolvedReturn(
  ctx: TriageContext, parsed: Record<string, any>, toolCallCount: number,
): LTReturn {
  return {
    type: 'return',
    data: {
      triaged: true, exitedVortex: false, hasCorrectedData: false, correctedData: null,
      originId: ctx.originId,
      originalWorkflowType: ctx.originalWorkflowType,
      originalTaskQueue: ctx.originalTaskQueue,
      originalTaskId: ctx.originalTaskId,
      diagnosis: parsed.diagnosis || 'AI triage could not determine a fix',
      actions_taken: parsed.actions_taken || [],
      tool_calls_made: toolCallCount,
      recommendation: parsed.recommendation || '',
      confidence: parsed.confidence || 0,
    },
    milestones: [
      { name: 'triage', value: 'completed' },
      { name: 'triage_method', value: toolCallCount > 0 ? 'llm_with_tools' : 'llm_direct' },
      { name: 'tool_calls', value: String(toolCallCount) },
      { name: 'vortex', value: 'unresolved' },
    ],
  };
}

// ── JSON parsing ──────────────────────────────────────────────

export function stripJsonComments(text: string): string {
  return text.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
}

export function parseTriageResponse(content: string): Record<string, any> {
  const cleaned = content
    .replace(/^```(?:json)?\s*/m, '')
    .replace(/\s*```$/m, '')
    .trim();

  const noComments = stripJsonComments(cleaned);
  try {
    return JSON.parse(noComments);
  } catch {
    const jsonMatch = noComments.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try { return JSON.parse(jsonMatch[0]); } catch { /* fall through */ }
    }
    return { diagnosis: cleaned || 'No response generated', actions_taken: [], correctedData: null, confidence: 0 };
  }
}
