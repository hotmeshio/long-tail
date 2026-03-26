/**
 * Analyze stage: run pattern detection and naive input classification.
 *
 * Wraps the existing pattern-detector and input-analyzer modules,
 * populating the pipeline context with their results.
 */

import { collapseIterationPatterns, detectPatterns } from '../pattern-detector';
import { extractSemanticInputs } from '../input-analyzer';
import type { PipelineContext, ExtractedStep } from '../types';

/**
 * Analyze pipeline stage: detect patterns and classify inputs.
 */
export async function analyze(ctx: PipelineContext): Promise<PipelineContext> {
  // Detect structural patterns (informational — passed to compile stage)
  ctx.patternAnnotations = detectPatterns(ctx.rawSteps as Parameters<typeof detectPatterns>[0]);

  // Collapse iteration patterns: N consecutive calls → single step with _iteration metadata
  ctx.collapsedSteps = collapseIterationPatterns(
    ctx.rawSteps as Parameters<typeof collapseIterationPatterns>[0],
  ) as ExtractedStep[];

  // Advisory: consecutive steps from the same server
  const consecutiveSameServer = ctx.collapsedSteps.filter((s, i) =>
    s.kind === 'tool' && s.mcpServerId &&
    i > 0 && ctx.collapsedSteps[i - 1].mcpServerId === s.mcpServerId,
  );
  if (consecutiveSameServer.length > 0) {
    const { loggerRegistry } = await import('../../logger');
    const serverIds = [...new Set(consecutiveSameServer.map(s => s.mcpServerId))];
    loggerRegistry.info(
      `[yaml-workflow] hint: ${consecutiveSameServer.length + 1} consecutive same-server steps detected (${serverIds.join(', ')}) — pattern detector may collapse these`,
    );
  }

  // Naive input classification: classify all step arguments as dynamic/fixed/wired
  ctx.naiveInputs = extractSemanticInputs(
    ctx.collapsedSteps as Parameters<typeof extractSemanticInputs>[0],
    ctx.originalPrompt,
  );

  return ctx;
}
