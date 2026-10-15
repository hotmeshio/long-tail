/** The caller's read scope, as the scoped escalation queries consume it. */
export interface ReadScopeInput {
  global?: boolean;
  visibleRoles?: string[];
  selfRoles?: string[];
  meUserId?: string;
}

/**
 * The read-scope predicate: `role ∈ visibleRoles OR (role ∈ selfRoles AND
 * assigned_to = me)`. Null for global access. `alias` qualifies the columns
 * when the query joins several escalation rows.
 */
export function buildReadScopeClause(
  scope: ReadScopeInput,
  params: unknown[],
  alias?: string,
): string | null {
  if (scope.global) return null;
  const col = (name: string) => (alias ? `${alias}.${name}` : name);
  const ai = params.push(scope.visibleRoles?.length ? scope.visibleRoles : null);
  const si = params.push(scope.selfRoles?.length ? scope.selfRoles : null);
  const mi = params.push(scope.meUserId || null);
  return `(($${ai}::text[] IS NULL AND $${si}::text[] IS NULL)
        OR ($${ai}::text[] IS NOT NULL AND ${col('role')} = ANY($${ai}))
        OR ($${si}::text[] IS NOT NULL AND ${col('role')} = ANY($${si}) AND ${col('assigned_to')} = $${mi}))`;
}
