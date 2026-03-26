/**
 * Build stage: construct the HotMesh YAML DAG from the compilation plan.
 *
 * When an EnhancedCompilationPlan is available, uses its iteration specs,
 * data flow edges, and key mappings to build a faithful deterministic DAG.
 * Falls back to mechanical heuristics when no plan is available.
 */

import { buildEnrichedInputSchema } from '../../input-analyzer';
import type { PipelineContext, EnhancedCompilationPlan, ExtractedStep } from '../../types';

import { inferSchema } from './utils';
import { deriveCategory, deriveTagsFromSteps } from './metadata';
import { findIterationSpec } from './iteration';
import {
  initializeDag,
  appendIterationStep,
  appendNormalStep,
  serializeToYaml,
} from './dag';

// Re-export public utilities used by other modules
export { capToolArguments, sanitizeName } from './utils';

/**
 * Build pipeline stage: construct the HotMesh YAML DAG.
 *
 * Reads as a five-phase pipeline:
 *   1. Prepare inputs (schema, session fields, index mapping)
 *   2. Initialize the DAG with a trigger activity
 *   3. Append each step as an iteration or normal activity
 *   4. Serialize to YAML
 *   5. Derive metadata (tags, category)
 */
export async function build(ctx: PipelineContext): Promise<PipelineContext> {
  const { options, coreSteps: steps, refinedInputs, compilationPlan: plan } = ctx;

  // 1. Prepare inputs
  const inputSchema = buildEnrichedInputSchema(refinedInputs);
  const triggerInputKeys = new Set(refinedInputs.map(f => f.key));
  const sessionFields = resolveSessionFields(plan);
  const collapsedToCoreIndex = buildCoreStepIndexMap(plan, ctx.collapsedSteps);
  const outputSchema = inferOutputSchema(steps);
  const prefix = buildActivityPrefix(options.subscribes);

  // 2. Initialize DAG with trigger
  const dag = initializeDag(prefix, options.subscribes, inputSchema);

  // 3. Build each step — iteration or normal
  steps.forEach((step, idx) => {
    const iterSpec = findIterationSpec(idx, plan, step, collapsedToCoreIndex);

    if (iterSpec) {
      appendIterationStep(
        dag, iterSpec, prefix, options.subscribes,
        idx, step, triggerInputKeys, steps, sessionFields, plan,
      );
    } else {
      appendNormalStep(
        dag, idx, step, prefix, options.subscribes,
        plan, steps, triggerInputKeys, collapsedToCoreIndex,
      );
    }
  });

  // 4. Serialize to YAML
  ctx.yaml = serializeToYaml(options.appId, options.subscribes, inputSchema, outputSchema, dag);
  ctx.inputSchema = inputSchema;
  ctx.outputSchema = outputSchema;
  ctx.activityManifest = dag.manifest;

  // 5. Derive metadata
  ctx.tags = deriveTagsFromSteps(steps, options.name, options.description);
  ctx.category = await deriveCategory(steps);

  return ctx;
}

// ── Preparation helpers ──────────────────────────────────────────────────────

/** Resolve session fields from the compilation plan or use sensible defaults. */
function resolveSessionFields(plan: EnhancedCompilationPlan | null): string[] {
  return plan?.sessionFields?.length
    ? plan.sessionFields
    : ['page_id', '_handle', 'session_id'];
}

/**
 * Build a remapping from collapsed-step indices to core-step indices.
 *
 * The compilation plan uses indices from collapsedSteps, but after core-step
 * filtering those indices shift. This map translates between the two spaces.
 */
function buildCoreStepIndexMap(
  plan: EnhancedCompilationPlan | null,
  collapsedSteps: ExtractedStep[],
): Map<number, number> {
  const map = new Map<number, number>();
  if (plan && plan.coreStepIndices.length > 0 && plan.coreStepIndices.length < collapsedSteps.length) {
    plan.coreStepIndices.forEach((collapsedIdx, coreIdx) => {
      map.set(collapsedIdx, coreIdx);
    });
  }
  return map;
}

/** Infer an output schema from the last step's result. */
function inferOutputSchema(steps: ExtractedStep[]): Record<string, unknown> {
  const lastStep = steps[steps.length - 1];
  return lastStep?.result
    ? inferSchema(lastStep.result)
    : { type: 'object' as const };
}

/**
 * Build a sanitized activity-ID prefix from the graph topic.
 * HotMesh has a max activity ID length — keep the prefix ≤ 20 chars.
 */
function buildActivityPrefix(graphTopic: string): string {
  const raw = graphTopic.replace(/[^a-z0-9]/g, '_');
  return raw.length > 20 ? raw.slice(0, 20) : raw;
}
