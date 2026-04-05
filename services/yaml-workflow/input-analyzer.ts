/**
 * Semantic input extraction for YAML workflow generator.
 *
 * Analyzes all steps from an execution and classifies each argument as:
 * - **dynamic**: user-provided at invocation time (e.g., url, query, password)
 * - **fixed**: implementation detail with a sensible default (e.g., selector, timeout)
 * - **wired**: inter-step data from previous step output (e.g., page_id, content)
 */

import type { InputFieldMeta } from '../../types/yaml-workflow';

import {
  classifyArgument,
  capDefault,
  flattenDynamicObject,
  humanize,
  inferType,
} from './input-analyzer-helpers';

import type { ExtractedStepLike } from './input-analyzer-helpers';

// Re-export everything from helpers so existing consumers are unaffected
export { classifyArgument } from './input-analyzer-helpers';
export type { ExtractedStepLike } from './input-analyzer-helpers';

/**
 * Scan ALL steps from an execution and return classified `InputFieldMeta[]`.
 *
 * - Iterates every step's arguments and classifies each key
 * - Deduplicates by key (first occurrence wins)
 * - Skips wired arguments (they come from step chaining)
 * - Flattens nested objects that contain dynamic keys
 * - Caps large defaults (arrays, objects) to prevent hardcoded execution data
 * - Enhances descriptions using the original prompt where possible
 */
export function extractSemanticInputs(
  steps: ExtractedStepLike[],
  originalPrompt: string,
): InputFieldMeta[] {
  const seen = new Map<string, InputFieldMeta>();

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (step.kind !== 'tool') continue;

    for (const [key, value] of Object.entries(step.arguments)) {
      if (key === '_iteration') continue;
      // First occurrence wins
      if (seen.has(key)) continue;

      const classification = classifyArgument(key, value, {
        stepIndex: i,
        toolName: step.toolName,
      });

      // Skip wired arguments — they come from step chaining
      if (classification === 'wired') continue;

      // Flatten nested objects that contain dynamic keys.
      // e.g., login: { url, username, password } → login_url, username, password
      if (classification === 'dynamic' && value && typeof value === 'object' && !Array.isArray(value)) {
        flattenDynamicObject(key, value as Record<string, unknown>, i, step.toolName, originalPrompt, seen);
        continue;
      }

      let description = humanize(key);

      // Enhance description from original prompt if the value appears in it
      if (originalPrompt && value !== null && value !== undefined) {
        const valueStr = String(value);
        if (valueStr.length > 2 && valueStr.length < 200 && originalPrompt.includes(valueStr)) {
          description += ` (from prompt: "${valueStr}")`;
        }
      }

      // Cap defaults for large arrays/objects — they're execution-specific data
      const cappedDefault = classification === 'fixed' ? capDefault(value) : undefined;

      seen.set(key, {
        key,
        type: inferType(value),
        ...(cappedDefault !== undefined ? { default: cappedDefault } : {}),
        description,
        classification,
        source_step_index: i,
        source_tool: step.toolName,
      });
    }
  }

  return Array.from(seen.values());
}

/**
 * Build a JSON Schema from classified input field metadata.
 *
 * - `dynamic` fields become required properties (no default — user must provide)
 * - `fixed` fields become optional properties with defaults from the execution
 */
export function buildEnrichedInputSchema(
  fieldMeta: InputFieldMeta[],
): Record<string, unknown> {
  if (fieldMeta.length === 0) {
    return { type: 'object' };
  }

  const properties: Record<string, Record<string, unknown>> = {};
  const required: string[] = [];

  for (const field of fieldMeta) {
    const prop: Record<string, unknown> = {
      type: field.type,
      description: field.description,
    };

    if (field.classification === 'dynamic') {
      required.push(field.key);
    } else if (field.classification === 'fixed' && field.default !== undefined) {
      prop.default = field.default;
    }

    properties[field.key] = prop;
  }

  const schema: Record<string, unknown> = {
    type: 'object',
    properties,
  };

  if (required.length > 0) {
    schema.required = required;
  }

  return schema;
}
