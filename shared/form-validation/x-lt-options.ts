/**
 * x-lt-options — a select's option list resolved from the escalation context.
 * The field-level token names a `"domain.path"`; the value at that path is an
 * array of scalars (strings or numbers) that becomes the field's option list,
 * so one static role form can offer a different legal set per escalation
 * (e.g. `[1..N]` where N rides the envelope, or a versioned knowledge lookup
 * under the `lookup` domain).
 *
 *   x-lt-options   "domain.path" — e.g. "envelope.left_quantity_options"
 *                  paths may embed {{domain.path}} interpolation segments —
 *                  e.g. "lookup.geo.regions.{{resolver.country}}" — making
 *                  the option list follow another answer (cascading selects)
 *
 * A static `enum` takes precedence when both are present — the same
 * static-over-dynamic rule as x-lt-minimum/x-lt-maximum. Resolution is a
 * tri-state:
 *
 *   undefined  — no dynamic contract: a plain path that resolves to nothing
 *                (the field renders as its plain input; membership unenforced)
 *   []         — a dynamic (interpolated) contract offering nothing YET: the
 *                select renders disabled and a present value fails membership
 *   values     — the option list
 *
 * Non-scalar entries in a resolved array are dropped.
 */
import { hasInterpolation, interpolatePath, resolveCtxPath } from './ctx-path';

export const X_LT_OPTIONS = 'x-lt-options';

export type OptionValue = string | number;

/**
 * The field's effective option list: the static `enum` when present, else the
 * scalars at the token's `"domain.path"`.
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
  if (typeof sourcePath !== 'string') return undefined;

  // Interpolated tokens are a standing contract: even unresolvable, the field
  // stays a (disabled) select and fails closed. Plain paths keep the legacy
  // undefined-on-miss reading.
  const dynamic = hasInterpolation(sourcePath);
  const miss = dynamic ? ([] as OptionValue[]) : undefined;

  let concrete = sourcePath;
  if (dynamic) {
    const resolved = interpolatePath(sourcePath, ctx);
    if (resolved === null) return miss;
    concrete = resolved;
  }

  const cur = resolveCtxPath(concrete, ctx);
  if (!Array.isArray(cur)) return miss;
  const scalars = cur.filter(
    (v): v is OptionValue => typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v)),
  );
  return scalars.length > 0 ? scalars : miss;
}
