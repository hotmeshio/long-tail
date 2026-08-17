/**
 * x-lt-require-sum — "these quantities must total at least N" as a
 * root-schema token. Where x-lt-require-any asks that one member carry any
 * answer (so a count defaulting to `0` vacuously satisfies it), require-sum
 * reads the members as numbers and demands their sum reach a minimum. The
 * canonical case: a Left quantity and a Right quantity that both default to
 * `0`, where at least one side must be positive.
 *
 *   x-lt-require-sum   { fields: string[], minimum?: number }[]
 *                      — e.g. [{ "fields": ["left_quantity", "right_quantity"] }]
 *
 * `minimum` defaults to 1. Numbers contribute their value and numeric strings
 * coerce (the same reading as dynamic bounds); everything else contributes 0.
 * Visibility rules compose the same way as require-any: a member hidden by
 * its `x-lt-showIf` (or naming no schema property) contributes nothing and is
 * not demanded, and a group whose members are ALL hidden is waived.
 */

export const X_LT_REQUIRE_SUM = 'x-lt-require-sum';

export interface RequireSumGroup {
  fields: string[];
  minimum: number;
}

/**
 * The schema's require-sum groups. Malformed declarations (non-array token,
 * groups without a fields array, non-string members, non-numeric minimum)
 * read as no groups — a bad token never bricks submission.
 */
export function readRequireSumGroups(
  schema: Record<string, unknown> | null | undefined,
): RequireSumGroup[] {
  const raw = schema?.[X_LT_REQUIRE_SUM];
  if (!Array.isArray(raw)) return [];
  const groups: RequireSumGroup[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const { fields, minimum } = entry as Record<string, unknown>;
    if (!Array.isArray(fields)) continue;
    const members = fields.filter((m): m is string => typeof m === 'string' && m.length > 0);
    if (members.length === 0) continue;
    if (minimum !== undefined && typeof minimum !== 'number') continue;
    groups.push({ fields: members, minimum: typeof minimum === 'number' ? minimum : 1 });
  }
  return groups;
}

/** A member's numeric contribution: numbers as-is, numeric strings coerced, all else 0. */
export function requireSumContribution(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    if (!Number.isNaN(n)) return n;
  }
  return 0;
}
