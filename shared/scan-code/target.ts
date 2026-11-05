// How a row's facet value matches a scanned target. Pure and isomorphic.

/** True when the facet holds the target: equal to it, or a list containing it. */
export function facetHolds(value: unknown, target: string): boolean {
  return Array.isArray(value) ? value.includes(target) : value === target;
}

/** The target a row's facet names: the value, or the first member of a list. */
export function facetTarget(value: unknown): string | null {
  const first = Array.isArray(value) ? value[0] : value;
  return typeof first === 'string' && first ? first : null;
}
