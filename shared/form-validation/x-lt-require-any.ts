/**
 * x-lt-require-any — "at least one of this set" as a root-schema token. A
 * form_schema declares groups of field names; a submission passes when every
 * group has a value in at least one member. The canonical case: a Left
 * quantity and a Right quantity where either satisfies, but blank-both fails.
 *
 *   x-lt-require-any   string[][] — e.g. [["left_quantity", "right_quantity"]]
 *
 * Visibility rules compose: a member hidden by its `x-lt-showIf` (or naming
 * no schema property) can neither satisfy the group nor be demanded of the
 * submitter, and a group whose members are ALL hidden is waived. `false` and
 * `0` are answers; `''`, null, and undefined are not.
 */

export const X_LT_REQUIRE_ANY = 'x-lt-require-any';

/**
 * The schema's require-any groups. Malformed declarations (non-array token,
 * non-array groups, non-string members) read as no groups — a bad token never
 * bricks submission.
 */
export function readRequireAnyGroups(
  schema: Record<string, unknown> | null | undefined,
): string[][] {
  const raw = schema?.[X_LT_REQUIRE_ANY];
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((group): group is unknown[] => Array.isArray(group))
    .map((group) => group.filter((m): m is string => typeof m === 'string' && m.length > 0))
    .filter((group) => group.length > 0);
}

/** Present = an actual answer: `false` and `0` count; `''`/null/undefined do not. */
export function hasRequireAnyValue(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  return true;
}
