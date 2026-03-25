/**
 * Utility functions for the build pipeline stage.
 */

import { TOOL_ARG_LIMIT_CAP } from '../../../../modules/defaults';

/**
 * Check if two keys are semantically related (for computed key fallback).
 * Replicates the logic from pattern-detector but local to the build stage.
 */
export function keysRelated(a: string, b: string): boolean {
  const la = a.toLowerCase();
  const lb = b.toLowerCase();
  if (la.includes(lb) || lb.includes(la)) return true;
  const urlKeys = ['url', 'href', 'link', 'src'];
  if (urlKeys.includes(la) && urlKeys.includes(lb)) return true;
  const pathKeys = ['path', 'file', 'filepath', 'filename', 'name'];
  if (pathKeys.some(p => la.includes(p)) && pathKeys.some(p => lb.includes(p))) return true;
  return false;
}

/** Cap `limit` in tool arguments to avoid sending huge payloads to downstream LLM steps. */
export function capToolArguments(args: Record<string, unknown>): Record<string, unknown> {
  const capped = { ...args };
  if (typeof capped.limit === 'number' && capped.limit > TOOL_ARG_LIMIT_CAP) {
    capped.limit = TOOL_ARG_LIMIT_CAP;
  }
  return capped;
}

/** Sanitize a name for use in HotMesh app IDs and topics. */
export function sanitizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/** Convert a snake_case/camelCase field name to a readable label. */
export function humanize(name: string): string {
  return name
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

/**
 * Infer a JSON Schema from a sample value, recursively.
 */
export function inferSchema(value: unknown, withDefault = false): Record<string, unknown> {
  if (value === null || value === undefined) {
    return { type: 'string' };
  }

  if (typeof value === 'string') {
    const schema: Record<string, unknown> = { type: 'string' };
    if (withDefault) schema.default = value;
    return schema;
  }

  if (typeof value === 'number') {
    const schema: Record<string, unknown> = { type: 'number' };
    if (withDefault) schema.default = value;
    return schema;
  }

  if (typeof value === 'boolean') {
    const schema: Record<string, unknown> = { type: 'boolean' };
    if (withDefault) schema.default = value;
    return schema;
  }

  if (Array.isArray(value)) {
    const schema: Record<string, unknown> = { type: 'array' };
    if (withDefault) schema.default = value;

    if (value.length > 0) {
      if (value.every((v) => typeof v === 'string')) {
        schema.items = { type: 'string' };
      } else if (value.every((v) => typeof v === 'number')) {
        schema.items = { type: 'number' };
      } else if (value.every((v) => v && typeof v === 'object' && !Array.isArray(v))) {
        const allKeys = new Map<string, unknown>();
        for (const el of value) {
          for (const [k, v] of Object.entries(el as Record<string, unknown>)) {
            if (!allKeys.has(k)) allKeys.set(k, v);
          }
        }
        const props: Record<string, unknown> = {};
        for (const [k, v] of allKeys) {
          props[k] = inferSchema(v, false);
          (props[k] as Record<string, unknown>).description = humanize(k);
        }
        schema.items = { type: 'object', properties: props };
      }
    }
    return schema;
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    const props: Record<string, unknown> = {};
    for (const [k, v] of entries) {
      props[k] = inferSchema(v, withDefault);
      (props[k] as Record<string, unknown>).description = humanize(k);
    }
    return { type: 'object', properties: props };
  }

  return { type: 'string' };
}

/**
 * Build data mappings from a previous activity's output fields.
 */
export function buildInputMappings(
  prevActivityId: string,
  prevResult: unknown,
): Record<string, string> {
  const mappings: Record<string, string> = {};
  if (prevResult && typeof prevResult === 'object' && !Array.isArray(prevResult)) {
    for (const key of Object.keys(prevResult as Record<string, unknown>)) {
      mappings[key] = `{${prevActivityId}.output.data.${key}}`;
    }
  }
  return mappings;
}
