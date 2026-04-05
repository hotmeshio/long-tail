/**
 * Compile stage: LLM-powered intent compilation.
 *
 * Calls an LLM to review the execution steps + original prompt and produce
 * an EnhancedCompilationPlan — a rich specification including iteration specs,
 * data flow graphs, key mappings, and session field identification.
 */

import type { InputFieldMeta } from '../../../../types/yaml-workflow';
import type { EnhancedCompilationPlan, PipelineContext } from '../../types';
import { callCompilationLLM } from './llm-call';

/**
 * Apply a compilation plan to override the naive input field metadata.
 */
function applyInputOverrides(
  planInputs: EnhancedCompilationPlan['inputs'],
  naiveInputs: InputFieldMeta[],
): InputFieldMeta[] {
  const naiveByKey = new Map(naiveInputs.map(f => [f.key, f]));

  return planInputs.map(inp => {
    const naive = naiveByKey.get(inp.key);
    return {
      key: inp.key,
      type: inp.type,
      classification: inp.classification,
      description: inp.description,
      ...(inp.classification === 'fixed' && inp.default !== undefined
        ? { default: inp.default }
        : {}),
      source_step_index: naive?.source_step_index ?? 0,
      source_tool: naive?.source_tool ?? 'unknown',
    };
  });
}

/**
 * Compile pipeline stage: call LLM to produce an EnhancedCompilationPlan.
 *
 * Falls back gracefully when the LLM is unavailable — the build stage
 * uses mechanical heuristics as before.
 */
export async function compile(ctx: PipelineContext): Promise<PipelineContext> {
  // Build retry context if this is a recompilation after a failed deployment or validation
  const retryHint = ctx.priorDeployError
    ? [
        `\n## RECOMPILATION — Prior Attempt Failed`,
        `The previous compilation produced YAML that failed with this error:`,
        `> ${ctx.priorDeployError}`,
        ``,
        `You MUST produce a plan that avoids this issue. Specifically:`,
        `- If the error mentions input key mismatches (e.g., 'login.url' vs 'url'), ensure your`,
        `  dataFlow edges use the exact field names each tool expects as inputs.`,
        `- If the error mentions missing input wiring or session handles, ensure all data dependencies`,
        `  (including _handle, page_id, and other session fields) are explicitly wired in dataFlow edges.`,
        `- If the error mentions "Duplicate activity id", ensure all activity IDs will be unique.`,
        `- If the error mentions invalid transitions, ensure data flow edges reference valid step indices.`,
        `- Review the failed YAML below for the specific structural issue and ensure your plan avoids it.`,
        ...(ctx.priorFailedYaml ? [
          ``,
          `### Failed YAML (excerpt)`,
          '```yaml',
          ctx.priorFailedYaml.slice(0, 2000),
          '```',
        ] : []),
      ].join('\n')
    : undefined;

  // Attempt LLM compilation
  ctx.compilationPlan = await callCompilationLLM(
    ctx.collapsedSteps,
    ctx.originalPrompt,
    ctx.naiveInputs,
    ctx.patternAnnotations,
    retryHint,
  );

  if (ctx.compilationPlan) {
    // Filter to core steps only
    const coreIndices = new Set(ctx.compilationPlan.coreStepIndices);
    if (coreIndices.size > 0 && coreIndices.size < ctx.collapsedSteps.length) {
      ctx.coreSteps = ctx.collapsedSteps.filter((_, idx) => coreIndices.has(idx));
    } else {
      ctx.coreSteps = [...ctx.collapsedSteps];
    }

    // Override input classifications with LLM's refined plan
    ctx.refinedInputs = applyInputOverrides(ctx.compilationPlan.inputs, ctx.naiveInputs);
  } else {
    // No plan — use collapsed steps and naive inputs as-is
    ctx.coreSteps = [...ctx.collapsedSteps];
    ctx.refinedInputs = [...ctx.naiveInputs];
  }

  return ctx;
}

// ── Re-exports for backward compatibility ─────────────────────────────────────

/** @deprecated Use EnhancedCompilationPlan from types.ts instead. */
export type CompilationPlan = EnhancedCompilationPlan;
