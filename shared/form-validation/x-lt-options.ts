/**
 * x-lt-options — a select's option list resolved from the escalation context.
 * The field-level token names a `"domain.path"`; the value at that path is an
 * array whose entries are scalars (strings or numbers) or `{ value, label }`
 * objects (`{ id, label }` accepted as an alias), so one static role form can
 * offer a different legal set per escalation (e.g. `[1..N]` where N rides the
 * envelope, or a versioned knowledge lookup under the `lookup` domain).
 *
 *   x-lt-options   "domain.path" — e.g. "envelope.left_quantity_options"
 *                  paths may embed {{domain.path}} interpolation segments —
 *                  e.g. "lookup.geo.regions.{{resolver.country}}" — making
 *                  the option list follow another answer (cascading selects)
 *
 * Object entries separate what the submitter SEES from what the payload
 * STORES: the select renders the label and emits the value (a DB-backed pick
 * list showing text while storing its foreign key). A scalar entry is both.
 *
 * A static `enum` takes precedence when both are present — the same
 * static-over-dynamic rule as x-lt-minimum/x-lt-maximum. Resolution is a
 * tri-state:
 *
 *   undefined  — no dynamic contract: a plain path that resolves to nothing
 *                (the field renders as its plain input; membership unenforced)
 *   []         — a dynamic (interpolated) contract offering nothing YET: the
 *                select renders disabled and a present value fails membership
 *   options    — the option list
 *
 * Malformed entries in a resolved array are dropped.
 */
import { hasInterpolation, interpolatePath, resolveCtxPath } from './ctx-path';

export const X_LT_OPTIONS = 'x-lt-options';

export type OptionValue = string | number;

/** One resolved option: the payload value and the rendered label. */
export interface ResolvedOption {
  value: OptionValue;
  label: string;
}

function isScalar(v: unknown): v is OptionValue {
  return typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v));
}

/** Normalize one array entry, mixed arrays resolving each entry independently. */
function toOption(entry: unknown): ResolvedOption | null {
  if (isScalar(entry)) return { value: entry, label: String(entry) };
  if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
    const o = entry as Record<string, unknown>;
    const value = o.value !== undefined ? o.value : o.id;
    if (isScalar(value) && typeof o.label === 'string' && o.label.length > 0) {
      return { value, label: o.label };
    }
  }
  return null;
}

/**
 * The field's effective option list: the static `enum` when present, else the
 * entries at the token's `"domain.path"`.
 */
export function resolveFieldOptions(
  fieldSchema: Record<string, unknown> | null | undefined,
  ctx: Record<string, unknown> | undefined,
): ResolvedOption[] | undefined {
  if (!fieldSchema) return undefined;

  // Enum entries pass through verbatim as values (whatever their type), each
  // labeled by its string form — the legacy membership contract is unchanged.
  const staticEnum = fieldSchema.enum;
  if (Array.isArray(staticEnum) && staticEnum.length > 0) {
    return staticEnum.map((v) => ({ value: v as OptionValue, label: String(v) }));
  }

  const sourcePath = fieldSchema[X_LT_OPTIONS];
  if (typeof sourcePath !== 'string') return undefined;

  // Interpolated tokens are a standing contract: even unresolvable, the field
  // stays a (disabled) select and fails closed. Plain paths keep the legacy
  // undefined-on-miss reading.
  const dynamic = hasInterpolation(sourcePath);
  const miss = dynamic ? ([] as ResolvedOption[]) : undefined;

  let concrete = sourcePath;
  if (dynamic) {
    const resolved = interpolatePath(sourcePath, ctx);
    if (resolved === null) return miss;
    concrete = resolved;
  }

  const cur = resolveCtxPath(concrete, ctx);
  if (!Array.isArray(cur)) return miss;
  const options = cur.map(toOption).filter((o): o is ResolvedOption => o !== null);
  return options.length > 0 ? options : miss;
}
