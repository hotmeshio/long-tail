import type { FacetFilters } from '../api/escalations';

// The faceted query is DEEP-LINKED: every element lives in the URL as a JSON-encoded
// search param (the same names the API/route use), so a shared link reproduces the
// exact query and back/forward navigation restores it.

const parse = (v: string | null): any => {
  if (!v) return undefined;
  try { return JSON.parse(v); } catch { return undefined; }
};

const isEmpty = (v: unknown): boolean =>
  v == null ||
  (Array.isArray(v) && v.length === 0) ||
  (typeof v === 'object' && !Array.isArray(v) && Object.keys(v as object).length === 0);

/** Read the faceted query from URL search params. */
export function parseFacetParams(sp: URLSearchParams): FacetFilters {
  const f: FacetFilters = {};
  const facets = parse(sp.get('facets')); if (!isEmpty(facets)) f.facets = facets;
  const block = parse(sp.get('block')); if (!isEmpty(block)) f.block = block;
  const range = parse(sp.get('range')); if (!isEmpty(range)) f.range = range;
  const exists = parse(sp.get('exists')); if (!isEmpty(exists)) f.exists = exists;
  const roles = parse(sp.get('roles')); if (!isEmpty(roles)) f.roles = roles;
  const orderBy = parse(sp.get('orderBy')); if (!isEmpty(orderBy)) f.orderBy = orderBy;
  if (sp.get('available') != null) f.available = sp.get('available') === 'true';
  return f;
}

/** Write the faceted query onto URL search params (deleting empty elements). */
export function writeFacetParams(p: URLSearchParams, f: FacetFilters): void {
  const set = (k: string, v: unknown) => (isEmpty(v) ? p.delete(k) : p.set(k, JSON.stringify(v)));
  set('facets', f.facets);
  set('block', f.block);
  set('range', f.range);
  set('exists', f.exists);
  set('roles', f.roles);
  set('orderBy', f.orderBy);
  if (f.available == null) p.delete('available'); else p.set('available', String(f.available));
}

/** Count of active facet conditions (for the trigger badge). */
export function facetCount(f: FacetFilters): number {
  return (
    Object.keys(f.facets ?? {}).length +
    (f.block?.length ?? 0) +
    (f.range?.length ?? 0) +
    (f.exists?.length ?? 0) +
    (f.orderBy?.length ?? 0) +
    (f.available != null ? 1 : 0)
  );
}
