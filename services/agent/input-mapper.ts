import type { LTEvent } from '../../types';

/**
 * Resolve a template string like "{event.data.orderId}" against an event object.
 * Returns the resolved value, or the raw template if the path doesn't exist.
 */
function resolveTemplate(template: string, event: LTEvent): any {
  const match = template.match(/^\{(.+)\}$/);
  if (!match) return template;

  const path = match[1].split('.');
  let current: any = { event };

  for (const segment of path) {
    if (current == null || typeof current !== 'object') return template;
    current = current[segment];
  }

  return current ?? template;
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
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      result[key] = applyInputMapping(value, event);
    } else {
      result[key] = value;
    }
  }

  return result;
}
