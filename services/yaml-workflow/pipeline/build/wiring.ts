/**
 * Step input wiring logic for the build pipeline stage.
 */

import type {
  ExtractedStep,
  EnhancedCompilationPlan,
  DataFlowEdge,
} from '../../types';

import { keysRelated } from './utils';

/**
 * HotMesh @pipe sub-pipe for today's date as YYYY-MM-DD.
 * Follows RPN convention: operands row, then operator row.
 * Row 1: date.now() → epoch (operator, no extra operands)
 * Row 2: [isoString, 0, 10] — three operands for substring
 * Row 3: substring(isoString, 0, 10) → "YYYY-MM-DD"
 */
const DATE_SUB_PIPE = {
  '@pipe': [
    ['{@date.now}'],
    ['{@date.toISOString}', 0, 10],
    ['{@string.substring}'],
  ],
};

/**
 * Convert a scalar derivation spec into a HotMesh @pipe expression.
 * Uses fan-out/fan-in pattern: sub-pipes as row-level siblings, NOT nested inside array rows.
 */
function buildDerivationPipe(
  sourceRef: string,
  derivation: DataFlowEdge['derivation'],
): string | Record<string, unknown> {
  if (!derivation) return sourceRef;

  switch (derivation.strategy) {
    case 'concat': {
      const parts = derivation.parts || ['{value}'];
      const hasDate = parts.some((p: string) => p === '{date}');
      if (!hasDate) {
        // Simple concat — no sub-pipes needed
        const args = parts.map((p: string) => p === '{value}' ? sourceRef : p);
        if (args.length === 1 && args[0] === sourceRef) return sourceRef;
        return { '@pipe': [args, ['{@string.concat}']] };
      }
      // Fan-out/fan-in: each part that needs computation gets its own sub-pipe row
      const rows: unknown[] = [];
      for (const p of parts) {
        if (p === '{value}') {
          rows.push({ '@pipe': [[sourceRef]] });
        } else if (p === '{date}') {
          rows.push(DATE_SUB_PIPE);
        } else {
          rows.push({ '@pipe': [[p]] });
        }
      }
      rows.push(['{@string.concat}']);
      return { '@pipe': rows };
    }
    case 'template': {
      const tpl = derivation.template || '{value}';
      const segments = tpl.split(/(\{value\}|\{date\})/).filter(Boolean);
      const hasDate = segments.includes('{date}');
      if (!hasDate) {
        const args = segments.map((s: string) => s === '{value}' ? sourceRef : s);
        if (args.length === 1 && args[0] === sourceRef) return sourceRef;
        return { '@pipe': [args, ['{@string.concat}']] };
      }
      const rows: unknown[] = [];
      for (const s of segments) {
        if (s === '{value}') {
          rows.push({ '@pipe': [[sourceRef]] });
        } else if (s === '{date}') {
          rows.push(DATE_SUB_PIPE);
        } else {
          rows.push({ '@pipe': [[s]] });
        }
      }
      rows.push(['{@string.concat}']);
      return { '@pipe': rows };
    }
    case 'prefix': {
      const concatParts: unknown[] = [];
      if (derivation.prefix) concatParts.push(derivation.prefix);
      concatParts.push(sourceRef);
      if (derivation.suffix) concatParts.push(derivation.suffix);
      if (concatParts.length === 1) return sourceRef;
      return { '@pipe': [concatParts, ['{@string.concat}']] };
    }
    default:
      return sourceRef;
  }
}

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
): Record<string, unknown> {
  const inputMappings: Record<string, unknown> = {};

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
      // Skip edges that target a complex nested object argument — these are stored
      // defaults in tool_arguments (e.g., a nested `login` object with selectors)
      // and must not be overridden by a flat scalar from an upstream step.
      if (step.kind === 'tool' && !edge.transform) {
        const argValue = step.arguments[edge.toField];
        if (argValue && typeof argValue === 'object' && !Array.isArray(argValue) &&
            Object.keys(argValue as object).length > 2) {
          continue;
        }
      }
      if (edge.transform && Object.keys(edge.transform.fieldMap).length > 0) {
        // This edge has a transform — the reshape activity was inserted before this step.
        // Wire from the transform activity's output (which uses toField as the output key).
        const transformActId = `${prefix}_xf${stepIdx + 1}`;
        inputMappings[edge.toField] = `{${transformActId}.output.data.${edge.toField}}`;
      } else if (edge.fromStep === 'trigger') {
        const rawRef = `{${triggerId}.output.data.${edge.fromField}}`;
        inputMappings[edge.toField] = buildDerivationPipe(rawRef, edge.derivation);
      } else {
        // Remap the source step from collapsed to core index
        const remappedFrom = collapsedToCoreIndex?.get(edge.fromStep as number) ?? edge.fromStep;
        const sourceActId = stepIndexToActivityId.get(remappedFrom as number);
        if (sourceActId) {
          const rawRef = `{${sourceActId}.output.data.${edge.fromField}}`;
          inputMappings[edge.toField] = buildDerivationPipe(rawRef, edge.derivation);
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
        // didn't explicitly wire it, add the wiring.
        // Skip complex arguments (arrays, nested objects with >2 keys) — they are stored
        // defaults in tool_arguments and must not be overridden by flat trigger mappings.
        for (const key of Object.keys(step.arguments)) {
          if (inputMappings[key]) continue; // already wired
          if (key === '_iteration') continue;
          const argValue = step.arguments[key];
          if (Array.isArray(argValue) || (argValue && typeof argValue === 'object' && !Array.isArray(argValue) && Object.keys(argValue as object).length > 2)) {
            continue;
          }
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
