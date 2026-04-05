/**
 * Step summarization helpers for LLM compilation context.
 *
 * Truncates and structures execution step data so the LLM receives
 * concise but structurally complete information about each step.
 */

import type { ExtractedStep } from '../../types';

export interface StepSummary {
  index: number;
  kind: 'tool' | 'llm' | 'signal';
  toolName: string;
  server?: string;
  argumentKeys: string[];
  arguments: Record<string, unknown>;
  resultKeys: string[];
  /** Truncated result structure showing arrays and nested objects. */
  resultSample: unknown;
  /** If this step has _iteration metadata from pattern detector. */
  iterationMeta?: {
    tool: string;
    count: number;
    varyingKeys: string[];
    constantArgs: Record<string, unknown>;
    arraySource: { stepIndex: number; field: string } | null;
  };
}

/** Truncate a value for display in the LLM prompt. */
export function truncateValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    if (value.length <= 2) return value;
    return `[${value.length} items]`;
  }
  if (typeof value === 'string' && value.length > 200) {
    return value.slice(0, 200) + '...';
  }
  if (typeof value === 'object' && value !== null) {
    const str = JSON.stringify(value);
    if (str.length > 300) return str.slice(0, 300) + '...';
    return value;
  }
  return value;
}

/**
 * Truncate an object's values for LLM context, preserving structure.
 */
export function truncateObject(obj: Record<string, unknown>, maxDepth = 2): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (Array.isArray(value)) {
      if (value.length === 0) {
        result[key] = [];
      } else if (value.length <= 2) {
        result[key] = value.map(v =>
          v && typeof v === 'object' && !Array.isArray(v) && maxDepth > 1
            ? truncateObject(v as Record<string, unknown>, maxDepth - 1)
            : truncateValue(v),
        );
      } else {
        // Show array structure: type, length, and first item's keys
        const firstItem = value[0];
        if (firstItem && typeof firstItem === 'object' && !Array.isArray(firstItem)) {
          result[key] = {
            _type: 'array',
            _length: value.length,
            _itemKeys: Object.keys(firstItem as Record<string, unknown>),
            _firstItem: maxDepth > 1
              ? truncateObject(firstItem as Record<string, unknown>, maxDepth - 1)
              : `{${Object.keys(firstItem as Record<string, unknown>).join(', ')}}`,
          };
        } else {
          result[key] = { _type: 'array', _length: value.length, _itemType: typeof firstItem };
        }
      }
    } else if (value && typeof value === 'object' && maxDepth > 1) {
      result[key] = truncateObject(value as Record<string, unknown>, maxDepth - 1);
    } else {
      result[key] = truncateValue(value);
    }
  }
  return result;
}

/**
 * Summarize extracted steps for the LLM, including result structure.
 */
export function summarizeSteps(steps: ExtractedStep[]): StepSummary[] {
  // Pre-compute array outputs from all steps for provenance detection
  const arrayOutputs: Array<{ stepIndex: number; field: string; items: unknown[] }> = [];
  for (let i = 0; i < steps.length; i++) {
    const result = steps[i].result;
    if (result && typeof result === 'object' && !Array.isArray(result)) {
      for (const [field, value] of Object.entries(result as Record<string, unknown>)) {
        if (Array.isArray(value) && value.length > 0) {
          arrayOutputs.push({ stepIndex: i, field, items: value });
        }
      }
    }
  }

  return steps.map((step, index) => {
    const args: Record<string, unknown> = {};
    let iterationMeta: StepSummary['iterationMeta'] = undefined;

    for (const [key, value] of Object.entries(step.arguments)) {
      if (key === '_iteration') {
        const iter = value as Record<string, unknown>;
        iterationMeta = {
          tool: iter.tool as string,
          count: iter.count as number,
          varyingKeys: iter.varyingKeys as string[],
          constantArgs: iter.constantArgs as Record<string, unknown>,
          arraySource: iter.arraySource as { stepIndex: number; field: string } | null,
        };
      } else if (Array.isArray(value) && value.length > 3) {
        // Check if this array was likely derived from a prior step's output
        let provenance = '';
        for (const ao of arrayOutputs) {
          if (ao.stepIndex >= index) continue; // only prior steps
          if (ao.items.length > 0 && value.length > 0) {
            const sourceValues = new Set<string>();
            for (const item of ao.items) {
              if (item && typeof item === 'object') {
                for (const v of Object.values(item as Record<string, unknown>)) {
                  if (typeof v === 'string') sourceValues.add(v);
                }
              }
            }
            const targetValues: string[] = [];
            for (const item of value) {
              if (item && typeof item === 'object') {
                for (const v of Object.values(item as Record<string, unknown>)) {
                  if (typeof v === 'string') targetValues.push(v);
                }
              }
            }
            const overlap = targetValues.filter(v => sourceValues.has(v)).length;
            if (overlap > value.length * 0.3) {
              provenance = ` ⚠️ DERIVED FROM step ${ao.stepIndex} field "${ao.field}" (${overlap} overlapping values — this is NOT a user input, it was computed from step ${ao.stepIndex}'s output)`;
              break;
            }
          }
        }
        args[key] = `[Array of ${value.length} items, first: ${JSON.stringify(value[0]).slice(0, 200)}]${provenance}`;
      } else if (typeof value === 'string' && value.length > 300) {
        args[key] = value.slice(0, 300) + '...';
      } else {
        args[key] = value;
      }
    }

    // Build result sample showing structure (not just keys)
    let resultSample: unknown = null;
    if (step.result && typeof step.result === 'object') {
      if (Array.isArray(step.result)) {
        resultSample = {
          _type: 'array',
          _length: step.result.length,
          _firstItem: step.result[0] && typeof step.result[0] === 'object'
            ? truncateObject(step.result[0] as Record<string, unknown>)
            : step.result[0],
        };
      } else {
        resultSample = truncateObject(step.result as Record<string, unknown>);
      }
    }

    const resultKeys = step.result && typeof step.result === 'object' && !Array.isArray(step.result)
      ? Object.keys(step.result as Record<string, unknown>)
      : [];

    return {
      index,
      kind: step.kind,
      toolName: step.toolName,
      server: step.mcpServerId,
      argumentKeys: Object.keys(step.arguments).filter(k => k !== '_iteration'),
      arguments: args,
      resultKeys,
      resultSample,
      ...(iterationMeta ? { iterationMeta } : {}),
    };
  });
}
