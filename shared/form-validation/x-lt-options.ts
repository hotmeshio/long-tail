/**
 * x-lt-options — a select's option list resolved from the escalation context.
 * The field-level token names a `"domain.path"`; the value at that path is an
 * array of scalars (strings or numbers) that becomes the field's option list,
 * so one static role form can offer a different legal set per escalation
 * (e.g. `[1..N]` where N rides the envelope).
 *
 *   x-lt-options   "domain.path" — e.g. "envelope.left_quantity_options"
 *
 * A static `enum` takes precedence when both are present — the same
 * static-over-dynamic rule as x-lt-minimum/x-lt-maximum. A path that resolves
 * to nothing, or to no scalar entries, yields no options: the field renders as
 * a plain input for its type and membership is not enforced. Non-scalar
 * entries in a resolved array are dropped.
 */

export const X_LT_OPTIONS = 'x-lt-options';

export type OptionValue = string | number;

/**
 * The field's effective option list: the static `enum` when present, else the
 * scalars at the token's `"domain.path"`. Undefined when neither yields any.
 */
export function resolveFieldOptions(
  fieldSchema: Record<string, unknown> | null | undefined,
  ctx: Record<string, unknown> | undefined,
): OptionValue[] | undefined {
  if (!fieldSchema) return undefined;

  const staticEnum = fieldSchema.enum;
  if (Array.isArray(staticEnum) && staticEnum.length > 0) {
    return staticEnum as OptionValue[];
  }

  const sourcePath = fieldSchema[X_LT_OPTIONS];
  if (typeof sourcePath !== 'string' || !ctx) return undefined;
  const dot = sourcePath.indexOf('.');
  if (dot === -1) return undefined;
  const domainObj = ctx[sourcePath.slice(0, dot)];
  if (!domainObj || typeof domainObj !== 'object') return undefined;
  let cur: unknown = domainObj;
  for (const p of sourcePath.slice(dot + 1).split('.')) {
    cur = (cur as Record<string, unknown>)[p];
    if (cur === undefined) return undefined;
  }
  if (!Array.isArray(cur)) return undefined;
  const scalars = cur.filter(
    (v): v is OptionValue => typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v)),
  );
  return scalars.length > 0 ? scalars : undefined;
}
