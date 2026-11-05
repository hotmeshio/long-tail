import type { FacetValue } from '../types/facets';

/** True when a facet value names something to match: a non-empty string or a non-empty list of them. */
export function hasFacetValue(value: unknown): value is FacetValue {
  if (typeof value === 'string') return value.length > 0;
  return Array.isArray(value) && value.length > 0 && value.every((v) => typeof v === 'string' && v.length > 0);
}
