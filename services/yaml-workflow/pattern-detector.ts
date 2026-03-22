/**
 * Pattern detection for YAML workflow generation.
 *
 * Analyzes extracted step sequences to detect higher-order structural
 * patterns — entirely tool-agnostic. The detector recognizes shapes
 * in the call flow (iteration, repetition) and collapses them into
 * richer YAML structures.
 *
 * Patterns detected:
 * 1. **Iteration**: Same tool called N times with systematically varying
 *    arguments → collapse into a single step with an array input.
 * 2. **Constant args**: Arguments that don't change across repeated calls
 *    → extract as shared config (not iterated).
 * 3. **Array source**: When a prior step's result contains an array
 *    whose length matches the repetition count → link as the data source.
 */

interface ExtractedStepLike {
  kind: 'tool' | 'llm';
  toolName: string;
  arguments: Record<string, unknown>;
  result: unknown;
  source: string;
  mcpServerId?: string;
  promptMessages?: Array<{ role: string; content: string }>;
}

/** Keys that represent inter-step handles, not meaningful iteration data. */
const WIRED_KEYS = new Set(['page_id', '_handle', 'session_id']);

/**
 * Detect runs of consecutive calls to the same tool (same name + same server).
 */
function findConsecutiveRuns(steps: ExtractedStepLike[], minLength = 3): Array<{
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
 * - **wired**: inter-step handles — excluded from both
 */
function classifyRunArguments(run: ExtractedStepLike[]): {
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

/**
 * Find a prior step whose result contains an array field that is the likely
 * data source for the iteration. Uses two strategies:
 *
 * 1. **Key overlap**: Array items have keys matching the iteration's varying keys
 *    (e.g., links[].href matches the varying key `url` → this is the source)
 * 2. **Length match**: Array length matches the run length (fallback)
 *
 * Searches recursively through nested objects, returning a dot-path
 * (e.g., "links") so the YAML mapping references the correct depth.
 */
function findArraySource(
  steps: ExtractedStepLike[],
  runStartIndex: number,
  runLength: number,
  varyingKeys?: string[],
): { stepIndex: number; fieldName: string } | null {
  // Strategy 1: Find array whose items have keys overlapping with varying keys
  if (varyingKeys && varyingKeys.length > 0) {
    for (let i = runStartIndex - 1; i >= 0; i--) {
      const result = steps[i].result;
      if (!result || typeof result !== 'object' || Array.isArray(result)) continue;

      const path = findArrayByKeyOverlap(result as Record<string, unknown>, varyingKeys, '');
      if (path) {
        return { stepIndex: i, fieldName: path };
      }
    }
  }

  // Strategy 2: Exact length match (fallback)
  for (let i = runStartIndex - 1; i >= 0; i--) {
    const result = steps[i].result;
    if (!result || typeof result !== 'object' || Array.isArray(result)) continue;

    const path = findArrayByLength(result as Record<string, unknown>, runLength, '');
    if (path) {
      return { stepIndex: i, fieldName: path };
    }
  }

  return null;
}

/**
 * Find an array whose items contain keys that overlap with the iteration's
 * varying keys. For example, if varying keys are ['url', 'screenshot_path']
 * and a prior step returned { links: [{ text, href }, ...] }, the 'href'
 * key semantically matches 'url'. Returns the dot-path to the array.
 */
function findArrayByKeyOverlap(
  obj: Record<string, unknown>,
  varyingKeys: string[],
  prefix: string,
  maxDepth = 3,
): string | null {
  if (maxDepth <= 0) return null;

  for (const [key, value] of Object.entries(obj)) {
    if (Array.isArray(value) && value.length > 0) {
      const firstItem = value[0];
      if (firstItem && typeof firstItem === 'object' && !Array.isArray(firstItem)) {
        const itemKeys = Object.keys(firstItem as Record<string, unknown>);
        // Check if item keys overlap with varying keys or their semantic equivalents
        const hasOverlap = varyingKeys.some(vk =>
          itemKeys.includes(vk) ||
          itemKeys.some(ik => keysAreSemanticallyRelated(vk, ik)),
        );
        if (hasOverlap) {
          return prefix ? `${prefix}.${key}` : key;
        }
      }
    }
  }

  // Recurse into nested objects
  for (const [key, value] of Object.entries(obj)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const nested = findArrayByKeyOverlap(
        value as Record<string, unknown>,
        varyingKeys,
        prefix ? `${prefix}.${key}` : key,
        maxDepth - 1,
      );
      if (nested) return nested;
    }
  }

  return null;
}

/**
 * Check if two keys are semantically related.
 * E.g., 'url' ↔ 'href', 'path' ↔ 'screenshot_path'.
 */
function keysAreSemanticallyRelated(a: string, b: string): boolean {
  const la = a.toLowerCase();
  const lb = b.toLowerCase();
  // One contains the other
  if (la.includes(lb) || lb.includes(la)) return true;
  // URL-like equivalences
  const urlKeys = ['url', 'href', 'link', 'src'];
  if (urlKeys.includes(la) && urlKeys.includes(lb)) return true;
  // Path-like equivalences
  const pathKeys = ['path', 'file', 'filepath', 'filename'];
  if (pathKeys.some(p => la.includes(p)) && pathKeys.some(p => lb.includes(p))) return true;
  // Name/label equivalences (nav link text often maps to filenames)
  const nameKeys = ['name', 'text', 'label', 'title'];
  if (nameKeys.includes(la) && nameKeys.includes(lb)) return true;
  return false;
}

/** Find an array by exact length match (fallback strategy). */
function findArrayByLength(
  obj: Record<string, unknown>,
  targetLength: number,
  prefix: string,
  maxDepth = 3,
): string | null {
  if (maxDepth <= 0) return null;

  for (const [key, value] of Object.entries(obj)) {
    if (Array.isArray(value) && value.length === targetLength) {
      return prefix ? `${prefix}.${key}` : key;
    }
  }

  for (const [key, value] of Object.entries(obj)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const nested = findArrayByLength(
        value as Record<string, unknown>,
        targetLength,
        prefix ? `${prefix}.${key}` : key,
        maxDepth - 1,
      );
      if (nested) return nested;
    }
  }

  return null;
}

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
 * This function is entirely tool-agnostic — it knows nothing about
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
export interface PatternAnnotation {
  type: 'iteration';
  toolName: string;
  runStartIndex: number;
  iterationCount: number;
  varyingKeys: string[];
  constantKeys: string[];
  arraySource: { stepIndex: number; fieldName: string } | null;
}

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
