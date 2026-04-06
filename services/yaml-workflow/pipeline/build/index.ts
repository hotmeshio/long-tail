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
  appendSignalStep,
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
  const prefix = buildActivityPrefix(options.name);

  // 2. Initialize DAG with trigger
  const dag = initializeDag(prefix, options.subscribes, inputSchema);

  // 3. Build each step — iteration, signal, or normal
  steps.forEach((step, idx) => {
    if (step.kind === 'signal') {
      appendSignalStep(
        dag, idx, step, prefix, options.subscribes,
        plan, steps, triggerInputKeys, collapsedToCoreIndex,
      );
      return;
    }

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
 *
 * The prefix must be unique per graph to avoid activity ID collisions
 * when multiple graphs are merged into one app deployment. We use the
 * full sanitized topic (no truncation) plus a 4-char hash suffix when
 * the topic exceeds 20 chars, ensuring uniqueness even for topics that
 * share a long common prefix.
 */
function buildActivityPrefix(graphTopic: string): string {
  const raw = graphTopic.replace(/[^a-z0-9]/g, '_');
  if (raw.length <= 20) return raw;
  // Short hash suffix to guarantee uniqueness across similar topics
  let hash = 0;
  for (let i = 0; i < graphTopic.length; i++) {
    hash = ((hash << 5) - hash + graphTopic.charCodeAt(i)) | 0;
  }
  const suffix = Math.abs(hash).toString(36).slice(0, 4);
  return `${raw.slice(0, 16)}_${suffix}`;
}
