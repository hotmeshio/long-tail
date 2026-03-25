/**
 * Step input wiring logic for the build pipeline stage.
 */

import type {
  ExtractedStep,
  EnhancedCompilationPlan,
} from '../types';

import { keysRelated } from './utils';

/**
 * Build input mappings for a step using the compilation plan's data flow edges.
 * Falls back to mechanical backward-scan when no plan is available.
 */
export function wireStepInputs(
  stepIdx: number,
  step: ExtractedStep,
  plan: EnhancedCompilationPlan | null,
  stepIndexToActivityId: Map<number, string>,
  triggerId: string,
  triggerInputKeys: Set<string>,
  steps: ExtractedStep[],
  prefix: string,
  prevActivityId: string,
  prevResult: unknown,
  collapsedToCoreIndex?: Map<number, number>,
): Record<string, string> {
  const inputMappings: Record<string, string> = {};

  // Determine session fields for gap-fill after plan-driven wiring
  const sessionFieldSet = new Set(
    plan?.sessionFields?.length
      ? plan.sessionFields
      : ['page_id', '_handle', 'session_id'],
  );

  // Plan-driven wiring: use data flow edges from the compilation plan.
  // Remap indices from collapsed-step space to core-step space.
  if (plan && plan.dataFlow.length > 0) {
    // Remap the current step index back to collapsed space for edge matching
    const collapsedIdx = collapsedToCoreIndex?.size
      ? [...collapsedToCoreIndex.entries()].find(([_, core]) => core === stepIdx)?.[0] ?? stepIdx
      : stepIdx;
    const edgesForStep = plan.dataFlow.filter(e => e.toStep === collapsedIdx);
    for (const edge of edgesForStep) {
      if (edge.transform && Object.keys(edge.transform.fieldMap).length > 0) {
        // This edge has a transform — the reshape activity was inserted before this step.
        // Wire from the transform activity's output (which uses toField as the output key).
        const transformActId = `${prefix}_xf${stepIdx + 1}`;
        inputMappings[edge.toField] = `{${transformActId}.output.data.${edge.toField}}`;
      } else if (edge.fromStep === 'trigger') {
        inputMappings[edge.toField] = `{${triggerId}.output.data.${edge.fromField}}`;
      } else {
        // Remap the source step from collapsed to core index
        const remappedFrom = collapsedToCoreIndex?.get(edge.fromStep as number) ?? edge.fromStep;
        const sourceActId = stepIndexToActivityId.get(remappedFrom as number);
        if (sourceActId) {
          inputMappings[edge.toField] = `{${sourceActId}.output.data.${edge.fromField}}`;
        }
      }
    }
    // If the plan provided wiring for this step, gap-fill any missing session
    // fields and trigger inputs before returning — the LLM may have omitted them.
    if (edgesForStep.length > 0) {
      // Gap-fill session fields: backward scan for any session field the plan missed
      if (step.kind === 'tool') {
        for (const sf of sessionFieldSet) {
          if (inputMappings[sf]) continue; // already wired by plan
          // Only add if the step actually uses this field (present in arguments or
          // known to be required by the tool based on prior step outputs)
          const stepNeedsField = sf in step.arguments ||
            steps.slice(0, stepIdx).some(s =>
              s.result && typeof s.result === 'object' && !Array.isArray(s.result) &&
              sf in (s.result as Record<string, unknown>));
          if (!stepNeedsField) continue;
          for (let si = stepIdx - 1; si >= 0; si--) {
            const priorResult = steps[si].result;
            if (priorResult && typeof priorResult === 'object' && !Array.isArray(priorResult) &&
                sf in (priorResult as Record<string, unknown>)) {
              const priorActId = stepIndexToActivityId.get(si) || `${prefix}_a${si + 1}`;
              inputMappings[sf] = `{${priorActId}.output.data.${sf}}`;
              break;
            }
          }
        }
        // Gap-fill trigger inputs: if a step argument matches a trigger input but the plan
        // didn't explicitly wire it, add the wiring
        for (const key of Object.keys(step.arguments)) {
          if (inputMappings[key]) continue; // already wired
          if (key === '_iteration') continue;
          if (triggerInputKeys.has(key)) {
            inputMappings[key] = `{${triggerId}.output.data.${key}}`;
          }
        }
      }
      return inputMappings;
    }
  }

  // Mechanical fallback: match step argument keys against trigger inputs and prior outputs.
  // Skip complex array/object arguments — they come from stored tool_arguments, not wiring.
  if (step.kind === 'tool') {
    for (const key of Object.keys(step.arguments)) {
      if (key === '_iteration') continue;
      // Don't wire complex arguments (arrays, nested objects) — these are stored defaults
      const argValue = step.arguments[key];
      if (Array.isArray(argValue) || (argValue && typeof argValue === 'object' && !Array.isArray(argValue) && Object.keys(argValue as object).length > 2)) {
        continue;
      }
      if (triggerInputKeys.has(key)) {
        inputMappings[key] = `{${triggerId}.output.data.${key}}`;
      } else if (prevResult && typeof prevResult === 'object' && !Array.isArray(prevResult) &&
                 key in (prevResult as Record<string, unknown>)) {
        inputMappings[key] = `{${prevActivityId}.output.data.${key}}`;
      } else {
        // Walk backward to find any upstream step that produced this field
        for (let si = stepIdx - 1; si >= 0; si--) {
          const priorResult = steps[si].result;
          if (priorResult && typeof priorResult === 'object' && !Array.isArray(priorResult) &&
              key in (priorResult as Record<string, unknown>)) {
            const priorActId = stepIndexToActivityId.get(si) || `${prefix}_a${si + 1}`;
            inputMappings[key] = `{${priorActId}.output.data.${key}}`;
            break;
          }
        }
      }
    }
  } else {
    // LLM steps: wire all previous output fields
    if (prevResult && typeof prevResult === 'object' && !Array.isArray(prevResult)) {
      for (const key of Object.keys(prevResult as Record<string, unknown>)) {
        inputMappings[key] = `{${prevActivityId}.output.data.${key}}`;
      }
    }
  }

  // Mechanical gap-fill: ensure session fields are wired even when not in step.arguments
  // (they may be implicit inputs required by the tool but not captured in the trace args)
  if (step.kind === 'tool') {
    for (const sf of sessionFieldSet) {
      if (inputMappings[sf]) continue; // already wired
      for (let si = stepIdx - 1; si >= 0; si--) {
        const priorResult = steps[si].result;
        if (priorResult && typeof priorResult === 'object' && !Array.isArray(priorResult) &&
            sf in (priorResult as Record<string, unknown>)) {
          const priorActId = stepIndexToActivityId.get(si) || `${prefix}_a${si + 1}`;
          inputMappings[sf] = `{${priorActId}.output.data.${sf}}`;
          break;
        }
      }
    }
  }

  return inputMappings;
}
