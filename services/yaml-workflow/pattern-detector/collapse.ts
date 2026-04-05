/**
 * Iteration pattern collapse and detection.
 *
 * Collapses runs of repeated tool calls into single batch steps
 * with iteration metadata, and detects structural patterns for
 * informational annotation.
 */

import type { ExtractedStepLike, PatternAnnotation } from './types';
import { findConsecutiveRuns, classifyRunArguments } from './run-detection';
import { findArraySource } from './array-source';

/**
 * Collapse iteration patterns in the step sequence.
 *
 * Detects runs of 3+ consecutive calls to the same tool, analyzes
 * which arguments vary vs. stay constant, and replaces the run with
 * a single step that carries _iteration metadata.
 *
 * The YAML generator reads this annotation to produce either:
 * - A batch tool call (if the tool accepts arrays)
 * - A cycle/hook pattern (if iteration must happen in the graph)
 *
 * This function is entirely tool-agnostic -- it knows nothing about
 * playwright, screenshots, or any specific MCP server.
 */
export function collapseIterationPatterns(steps: ExtractedStepLike[]): ExtractedStepLike[] {
  const runs = findConsecutiveRuns(steps);
  if (runs.length === 0) return steps;

  const result: ExtractedStepLike[] = [];
  let cursor = 0;

  for (const run of runs) {
    // Add all steps before this run
    while (cursor < run.startIndex) {
      result.push(steps[cursor]);
      cursor++;
    }

    const { varying, constant, items } = classifyRunArguments(run.steps);
    const arraySource = findArraySource(steps, run.startIndex, run.steps.length, varying);

    // Create a collapsed step with iteration metadata
    const collapsedArgs: Record<string, unknown> = {
      ...constant,
      _iteration: {
        tool: run.toolName,
        server: run.serverId,
        items,
        varyingKeys: varying,
        constantArgs: constant,
        arraySource: arraySource
          ? { stepIndex: arraySource.stepIndex, field: arraySource.fieldName }
          : null,
        count: run.steps.length,
      },
    };

    const lastResult = run.steps[run.steps.length - 1].result;

    result.push({
      kind: 'tool',
      toolName: `${run.toolName}_batch`,
      arguments: collapsedArgs,
      result: lastResult,
      source: run.steps[0].source,
      mcpServerId: run.serverId,
    });

    cursor = run.endIndex;
  }

  while (cursor < steps.length) {
    result.push(steps[cursor]);
    cursor++;
  }

  return result;
}

/**
 * Detect structural patterns and return annotations (informational).
 */
export function detectPatterns(steps: ExtractedStepLike[]): PatternAnnotation[] {
  const runs = findConsecutiveRuns(steps);
  return runs.map(run => {
    const { varying, constant } = classifyRunArguments(run.steps);
    const arraySource = findArraySource(steps, run.startIndex, run.steps.length);

    return {
      type: 'iteration' as const,
      toolName: run.toolName,
      runStartIndex: run.startIndex,
      iterationCount: run.steps.length,
      varyingKeys: varying,
      constantKeys: Object.keys(constant),
      arraySource,
    };
  });
}
