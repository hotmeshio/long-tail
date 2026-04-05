/**
 * Detection and classification of consecutive tool-call runs.
 *
 * Finds sequences of 3+ consecutive calls to the same tool and
 * classifies their arguments as varying, constant, or wired.
 */

import type { ExtractedStepLike } from './types';
import { WIRED_KEYS } from './types';

/**
 * Detect runs of consecutive calls to the same tool (same name + same server).
 */
export function findConsecutiveRuns(steps: ExtractedStepLike[], minLength = 3): Array<{
  startIndex: number;
  endIndex: number;
  toolName: string;
  serverId: string | undefined;
  steps: ExtractedStepLike[];
}> {
  const runs: Array<{
    startIndex: number;
    endIndex: number;
    toolName: string;
    serverId: string | undefined;
    steps: ExtractedStepLike[];
  }> = [];

  let i = 0;
  while (i < steps.length) {
    const step = steps[i];
    if (step.kind !== 'tool') { i++; continue; }

    let runEnd = i + 1;
    while (
      runEnd < steps.length &&
      steps[runEnd].kind === 'tool' &&
      steps[runEnd].toolName === step.toolName &&
      steps[runEnd].mcpServerId === step.mcpServerId
    ) {
      runEnd++;
    }

    if (runEnd - i >= minLength) {
      runs.push({
        startIndex: i,
        endIndex: runEnd,
        toolName: step.toolName,
        serverId: step.mcpServerId,
        steps: steps.slice(i, runEnd),
      });
    }
    i = Math.max(i + 1, runEnd);
  }

  return runs;
}

/**
 * Analyze a run of repeated tool calls and separate arguments into:
 * - **varying**: keys whose values differ across calls (the iterated data)
 * - **constant**: keys whose values are identical across all calls (shared config)
 * - **wired**: inter-step handles -- excluded from both
 */
export function classifyRunArguments(run: ExtractedStepLike[]): {
  varying: string[];
  constant: Record<string, unknown>;
  items: Array<Record<string, unknown>>;
} {
  const allKeys = new Set<string>();
  for (const step of run) {
    for (const key of Object.keys(step.arguments)) {
      allKeys.add(key);
    }
  }

  const varying: string[] = [];
  const constant: Record<string, unknown> = {};

  for (const key of allKeys) {
    if (WIRED_KEYS.has(key)) continue;

    const values = run.map(s => JSON.stringify(s.arguments[key] ?? null));
    const allSame = values.every(v => v === values[0]);

    if (allSame) {
      constant[key] = run[0].arguments[key];
    } else {
      varying.push(key);
    }
  }

  const items = run.map(s => {
    const item: Record<string, unknown> = {};
    for (const key of varying) {
      if (s.arguments[key] !== undefined) {
        item[key] = s.arguments[key];
      }
    }
    return item;
  });

  return { varying, constant, items };
}
