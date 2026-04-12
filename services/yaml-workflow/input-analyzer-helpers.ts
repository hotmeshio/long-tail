/**
 * Helper utilities for semantic input analysis.
 *
 * Constants, classification logic, and value-processing functions
 * used by the main input-analyzer module.
 */

import type { InputFieldMeta } from '../../types/yaml-workflow';

/** Max array length to embed as a default — larger arrays are execution-specific data. */
export const MAX_DEFAULT_ARRAY_LENGTH = 3;

/** Max JSON string length to embed as an object default. */
export const MAX_DEFAULT_OBJECT_SIZE = 200;

/** Max string length to embed as a fixed default — longer strings are execution-specific content. */
export const MAX_DEFAULT_STRING_LENGTH = 500;

/** Keys that represent user-provided, per-invocation values. */
export const DYNAMIC_KEYS = new Set([
  'url', 'base_url', 'site_url', 'target_url',
  'username', 'password',
  'directory', 'path',
  'screenshot_path',
  'query', 'prompt', 'search',
]);

/** Keys that represent implementation details with sensible defaults. */
export const FIXED_KEYS = new Set([
  'selector', 'submit_selector', 'username_selector', 'password_selector',
  'css_selector', 'wait_until', 'timeout', 'wait_ms',
  'full_page', 'extract_links', 'extract_metadata',
  'limit', 'offset', 'wait_after_login', 'not',
]);

/** Keys that represent inter-step wired data (output from a previous step). */
export const WIRED_KEYS = new Set([
  'page_id', '_handle', 'content', 'links', 'files', 'result',
]);

export interface ExtractedStepLike {
  kind: 'tool' | 'llm';
  toolName: string;
  arguments: Record<string, unknown>;
  result?: unknown;
}

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

  // Arrays of objects are always fixed (structured implementation details)
  // or wired (from a prior step's output). Never user-provided dynamic inputs.
  if (Array.isArray(value)) {
    if (value.length > 0 && value[0] && typeof value[0] === 'object' && !Array.isArray(value[0])) {
      return 'fixed';
    }
    if (value.length > MAX_DEFAULT_ARRAY_LENGTH) {
      return 'dynamic';
    }
  }

  // Long strings are execution-specific content (prompts, templates), not reusable defaults
  if (typeof value === 'string' && value.length > MAX_DEFAULT_STRING_LENGTH) {
    return 'dynamic';
  }

  // Default: treat as fixed (has a default from the execution)
  return 'fixed';
}

/**
 * Check if an object's keys overlap with known dynamic keys.
 * E.g., { url: '...', username: '...', password: '...' } -> true
 */
function objectContainsDynamicKeys(obj: Record<string, unknown>): boolean {
  for (const key of Object.keys(obj)) {
    const lower = key.toLowerCase();
    if (DYNAMIC_KEYS.has(lower)) return true;
    if (lower.endsWith('_url') || lower.endsWith('_path')) return true;
  }
  return false;
}

/**
 * Check if an array argument was likely produced by a prior step's result.
 * Compares the item keys of the argument array against result arrays from prior steps.
 */
export function isArrayWiredFromPriorStep(
  value: unknown[],
  priorSteps: ExtractedStepLike[],
): boolean {
  if (value.length === 0 || !value[0] || typeof value[0] !== 'object') return false;
  const argKeys = new Set(Object.keys(value[0] as Record<string, unknown>));
  if (argKeys.size === 0) return false;

  for (const step of priorSteps) {
    if (!step.result || typeof step.result !== 'object') continue;
    const result = step.result as Record<string, unknown>;
    for (const field of Object.values(result)) {
      if (!Array.isArray(field) || field.length === 0) continue;
      const first = field[0];
      if (!first || typeof first !== 'object') continue;
      const resultKeys = new Set(Object.keys(first as Record<string, unknown>));
      // If the result array items share keys with the argument array items, it's wired
      let overlap = 0;
      for (const k of argKeys) if (resultKeys.has(k)) overlap++;
      if (overlap >= 2 || (overlap >= 1 && argKeys.size <= 3)) return true;
    }
  }
  return false;
}

/** Convert a snake_case/camelCase field name to a readable description. */
export function humanize(name: string): string {
  return name
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

/** Infer a JSON Schema type string from a JS value. */
export function inferType(value: unknown): string {
  if (value === null || value === undefined) return 'string';
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'number') return 'number';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'object') return 'object';
  return 'string';
}

/**
 * Cap a default value to prevent embedding large execution-specific data.
 * Returns undefined if the value is too large to serve as a sensible default.
 */
export function capDefault(value: unknown): unknown | undefined {
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
 * Flatten a nested object argument into individual top-level input fields.
 *
 * For example, `login: { url: '...', username: '...', password: '...' }`
 * becomes three separate fields: `login_url` (dynamic), `username` (dynamic),
 * `password` (dynamic), preserving the relationship via description.
 */
export function flattenDynamicObject(
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
