/**
 * YAML workflow generator — slim orchestrator for the compilation pipeline.
 *
 * Coordinates five stages:
 *   extract → analyze → compile → build → validate
 *
 * Each stage is a dedicated module in ./pipeline/ that receives and returns
 * a shared PipelineContext.
 */

import { exportWorkflowExecution } from '../export/index';

import { extract } from './pipeline/extract';
import { analyze } from './pipeline/analyze';
import { compile } from './pipeline/compile';
import { build } from './pipeline/build';
import { validate } from './pipeline/validate';
import { sanitizeName, capToolArguments } from './pipeline/build';
import type { PipelineContext, GenerateYamlOptions, GenerateYamlResult } from './types';

// Re-exports for backward compatibility
export { capToolArguments } from './pipeline/build';
export type { GenerateYamlOptions, GenerateYamlResult } from './types';
export type { EnhancedCompilationPlan as CompilationPlan } from './types';

/**
 * Generate a HotMesh YAML workflow from a completed execution's tool call sequence.
 *
 * Analyzes the execution events, extracts the ordered tool calls, compiles
 * them through an LLM-powered intent analysis, and produces a deterministic
 * YAML DAG that replaces the LLM with direct tool-to-tool piping.
 */
export async function generateYamlFromExecution(
  options: GenerateYamlOptions,
): Promise<GenerateYamlResult> {
  const appId = options.appId || 'longtail';
  const graphTopic = options.subscribes || sanitizeName(options.name);

  // 1. Export the execution to get events
  const execution = await exportWorkflowExecution(
    options.workflowId,
    options.taskQueue,
    options.workflowName,
  );

  // 2. Initialize pipeline context
  let ctx: PipelineContext = {
    options: { ...options, appId, subscribes: graphTopic },
    execution,
    originalPrompt: '',
    rawSteps: [],
    collapsedSteps: [],
    patternAnnotations: [],
    naiveInputs: [],
    compilationPlan: null,
    coreSteps: [],
    refinedInputs: [],
    yaml: '',
    inputSchema: {},
    outputSchema: {},
    activityManifest: [],
    tags: [],
    category: 'general',
    validationIssues: [],
    priorDeployError: options.compilationFeedback || options.priorDeployError,
    priorFailedYaml: options.priorFailedYaml,
  };

  // 3. Run pipeline stages
  ctx = await extract(ctx);
  ctx = await analyze(ctx);
  ctx = await compile(ctx);
  ctx = await build(ctx);
  ctx = await validate(ctx);

  // 4. Log validation warnings (informational — do not recompile)
  if (ctx.validationIssues.length > 0) {
    const { loggerRegistry } = await import('../../lib/logger');
    loggerRegistry.warn(
      `[yaml-workflow] Validation warnings (${ctx.validationIssues.length}): ${ctx.validationIssues.join('; ')}`,
    );
  }

  // 5. Return result
  return {
    yaml: ctx.yaml,
    inputSchema: ctx.inputSchema,
    outputSchema: ctx.outputSchema,
    activityManifest: ctx.activityManifest,
    graphTopic,
    appId,
    tags: ctx.tags,
    inputFieldMeta: ctx.refinedInputs,
    originalPrompt: ctx.originalPrompt,
    category: ctx.category,
    compilationPlan: ctx.compilationPlan,
    validationIssues: ctx.validationIssues,
  };
}
