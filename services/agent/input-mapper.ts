import type { LTEvent } from '../../types';

/**
 * Resolve a dotted path like "event.data.orderId" against `{ event }`.
 * Returns the resolved value, or `undefined` if any segment is missing.
 */
function resolvePath(path: string, event: LTEvent): any {
  const segments = path.trim().split('.');
  let current: any = { event };

  for (const segment of segments) {
    if (current == null || typeof current !== 'object') return undefined;
    current = current[segment];
  }

  return current;
}

/**
 * Resolve a template string against an event.
 *
 * - A string that is exactly one token resolving to a **non-scalar**
 *   (object/array) returns that value unchanged — full-object resolution,
 *   e.g. `"{event.data}"` → the whole data object.
 * - Every other string is interpolated **inline**: each `{path}` is replaced by
 *   `String(resolved)`. This covers tokens embedded in surrounding text, multiple
 *   tokens in one string, and single tokens that resolve to a scalar — e.g.
 *   `"https://host/lt?entity={event.workflowName}&q={event.workflowId}"`.
 *   A token whose path does not exist is left verbatim, so an unresolved
 *   `{event.data.missing}` passes through unchanged (other tokens still resolve).
 */
function resolveTemplate(template: string, event: LTEvent): any {
  const exact = template.match(/^\{([^}]+)\}$/);
  if (exact) {
    const resolved = resolvePath(exact[1], event);
    if (resolved !== null && resolved !== undefined && typeof resolved === 'object') {
      return resolved;
    }
  }

  return template.replace(/\{([^}]+)\}/g, (original, path) => {
    const resolved = resolvePath(path, event);
    return resolved !== null && resolved !== undefined ? String(resolved) : original;
  });
}

/**
 * Recursively apply input mapping templates against an event.
 *
 * Input mapping is a nested object where string values are templates:
 * ```json
 * {
 *   "data": {
 *     "orderId": "{event.data.orderId}",
 *     "errorMessage": "{event.data.error}"
 *   },
 *   "metadata": { "source": "agent", "certified": true }
 * }
 * ```
 *
 * Non-string values (numbers, booleans, null) pass through unchanged.
 */
export function applyInputMapping(
  mapping: Record<string, any>,
  event: LTEvent,
): Record<string, any> {
  const result: Record<string, any> = {};

  for (const [key, value] of Object.entries(mapping)) {
    if (typeof value === 'string') {
      result[key] = resolveTemplate(value, event);
    } else if (Array.isArray(value)) {
      result[key] = value.map((item) => {
        if (typeof item === 'string') {
          const resolved = resolveTemplate(item, event);
          // Coerce scalars to strings when the template was a string in an array context.
          // Objects/arrays pass through (e.g., "{event.data}" resolves to the full object).
          if (resolved !== null && resolved !== undefined && typeof resolved !== 'object') {
            return String(resolved);
          }
          return resolved;
        }
        if (item && typeof item === 'object') return applyInputMapping(item, event);
        return item;
      });
    } else if (value && typeof value === 'object') {
      result[key] = applyInputMapping(value, event);
    } else {
      result[key] = value;
    }
  }

  return result;
}
