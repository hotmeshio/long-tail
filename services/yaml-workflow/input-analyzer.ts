/**
 * Semantic input extraction for YAML workflow generator.
 *
 * Analyzes all steps from an execution and classifies each argument as:
 * - **dynamic**: user-provided at invocation time (e.g., url, query, password)
 * - **fixed**: implementation detail with a sensible default (e.g., selector, timeout)
 * - **wired**: inter-step data from previous step output (e.g., page_id, content)
 */

import type { InputFieldMeta } from '../../types/yaml-workflow';

/** Max array length to embed as a default — larger arrays are execution-specific data. */
const MAX_DEFAULT_ARRAY_LENGTH = 3;

/** Max JSON string length to embed as an object default. */
const MAX_DEFAULT_OBJECT_SIZE = 200;

/** Keys that represent user-provided, per-invocation values. */
const DYNAMIC_KEYS = new Set([
  'url', 'base_url', 'site_url', 'target_url',
  'username', 'password',
  'directory', 'path',
  'screenshot_path',
  'query', 'prompt', 'search',
]);

/** Keys that represent implementation details with sensible defaults. */
const FIXED_KEYS = new Set([
  'selector', 'submit_selector', 'username_selector', 'password_selector',
  'css_selector', 'wait_until', 'timeout', 'wait_ms',
  'full_page', 'extract_links', 'extract_metadata',
  'limit', 'offset', 'wait_after_login', 'not',
]);

/** Keys that represent inter-step wired data (output from a previous step). */
const WIRED_KEYS = new Set([
  'page_id', '_handle', 'content', 'links', 'files', 'result',
]);

/**
 * Classify a single argument key as dynamic, fixed, or wired.
 */
export function classifyArgument(
  key: string,
  value: unknown,
  _context?: { stepIndex: number; toolName: string },
): 'dynamic' | 'fixed' | 'wired' {
  const lower = key.toLowerCase();

  if (WIRED_KEYS.has(lower)) return 'wired';
  if (DYNAMIC_KEYS.has(lower)) return 'dynamic';
  if (FIXED_KEYS.has(lower)) return 'fixed';

  // Heuristic fallback: keys ending with _id or _handle are likely wired
  if (lower.endsWith('_id') || lower.endsWith('_handle')) return 'wired';
  // Keys ending with _selector are fixed
  if (lower.endsWith('_selector')) return 'fixed';
  // Keys ending with _url or _path are dynamic
  if (lower.endsWith('_url') || lower.endsWith('_path')) return 'dynamic';

  // Objects containing dynamic keys should be treated as dynamic
  // (e.g., login: { url, username, password } contains dynamic fields)
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    if (objectContainsDynamicKeys(value as Record<string, unknown>)) {
      return 'dynamic';
    }
  }

  // Arrays: complex instruction arrays (like browser steps) are fixed implementation details.
  // Only flat data arrays (URLs, IDs) that are large should be dynamic.
  if (Array.isArray(value)) {
    if (value.length > 0 && value[0] && typeof value[0] === 'object' && !Array.isArray(value[0])) {
      // Array of objects — check if it's an instruction array (has 'action', 'step', 'type' keys)
      const firstItem = value[0] as Record<string, unknown>;
      if ('action' in firstItem || 'step' in firstItem || 'type' in firstItem) {
        return 'fixed'; // Implementation recipe — not user input
      }
    }
    if (value.length > MAX_DEFAULT_ARRAY_LENGTH) {
      return 'dynamic';
    }
  }

  // Default: treat as fixed (has a default from the execution)
  return 'fixed';
}

/**
 * Check if an object's keys overlap with known dynamic keys.
 * E.g., { url: '...', username: '...', password: '...' } → true
 */
function objectContainsDynamicKeys(obj: Record<string, unknown>): boolean {
  for (const key of Object.keys(obj)) {
    const lower = key.toLowerCase();
    if (DYNAMIC_KEYS.has(lower)) return true;
    if (lower.endsWith('_url') || lower.endsWith('_path')) return true;
  }
  return false;
}

/** Convert a snake_case/camelCase field name to a readable description. */
function humanize(name: string): string {
  return name
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

/** Infer a JSON Schema type string from a JS value. */
function inferType(value: unknown): string {
  if (value === null || value === undefined) return 'string';
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'number') return 'number';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'object') return 'object';
  return 'string';
}

interface ExtractedStepLike {
  kind: 'tool' | 'llm';
  toolName: string;
  arguments: Record<string, unknown>;
}

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
 * Flatten a nested object argument into individual top-level input fields.
 *
 * For example, `login: { url: '...', username: '...', password: '...' }`
 * becomes three separate fields: `login_url` (dynamic), `username` (dynamic),
 * `password` (dynamic), preserving the relationship via description.
 */
function flattenDynamicObject(
  parentKey: string,
  obj: Record<string, unknown>,
  stepIndex: number,
  toolName: string,
  originalPrompt: string,
  seen: Map<string, InputFieldMeta>,
): void {
  for (const [childKey, childValue] of Object.entries(obj)) {
    const childClassification = classifyArgument(childKey, childValue, {
      stepIndex,
      toolName,
    });
    if (childClassification === 'wired') continue;

    // Avoid key collisions: if the child key already exists at top level,
    // prefix with parent name (e.g., login_url instead of url)
    let flatKey = childKey;
    if (seen.has(childKey)) {
      flatKey = `${parentKey}_${childKey}`;
    }
    if (seen.has(flatKey)) continue;

    let description = `${humanize(childKey)} (from ${humanize(parentKey)})`;
    if (originalPrompt && childValue !== null && childValue !== undefined) {
      const valueStr = String(childValue);
      if (valueStr.length > 2 && valueStr.length < 200 && originalPrompt.includes(valueStr)) {
        description += ` (from prompt: "${valueStr}")`;
      }
    }

    const cappedDefault = childClassification === 'fixed' ? capDefault(childValue) : undefined;

    seen.set(flatKey, {
      key: flatKey,
      type: inferType(childValue),
      ...(cappedDefault !== undefined ? { default: cappedDefault } : {}),
      description,
      classification: childClassification,
      source_step_index: stepIndex,
      source_tool: toolName,
    });
  }
}

/**
 * Cap a default value to prevent embedding large execution-specific data.
 * Returns undefined if the value is too large to serve as a sensible default.
 */
function capDefault(value: unknown): unknown | undefined {
  if (Array.isArray(value)) {
    if (value.length > MAX_DEFAULT_ARRAY_LENGTH) return undefined;
    return value;
  }
  if (typeof value === 'object' && value !== null) {
    const serialized = JSON.stringify(value);
    if (serialized.length > MAX_DEFAULT_OBJECT_SIZE) return undefined;
    return value;
  }
  return value;
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
