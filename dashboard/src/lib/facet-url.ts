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
  const jeopardy = sp.get('jeopardy');
  if (jeopardy === '1' || jeopardy === 'true') f.jeopardy = true;
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
  if (f.jeopardy === true) p.set('jeopardy', '1'); else p.delete('jeopardy');
}

/**
 * Build a metadata facet deep-link URL, preserving the native JS type of
 * `value` (number, boolean, string) so the JSONB containment query is
 * type-correct. Objects are JSON-stringified; primitives pass through.
 *
 * Single source of truth — use this everywhere a metadata-icon click
 * should navigate to a filtered queue (timeline cards, table rows, detail
 * panel). Never pass the value through String() first.
 */
export function metadataFacetUrl(key: string, value: unknown, role?: string | null): string {
  const facetValue = typeof value === 'object' && value !== null ? JSON.stringify(value) : value;
  const facets = encodeURIComponent(JSON.stringify({ [key]: facetValue }));
  if (role) {
    return `/escalations/available?role=${encodeURIComponent(role)}&facets=${facets}&status=all`;
  }
  return `/escalations/available?facets=${facets}&status=all`;
}

/** Count of active facet CONDITIONS (for the trigger badge). Sort (orderBy) is
 *  deliberately excluded — it reorders, it doesn't narrow, and it must never
 *  flip the page into a filtered presentation (e.g. auto-timeline) by itself. */
export function facetCount(f: FacetFilters): number {
  return (
    Object.keys(f.facets ?? {}).length +
    (f.block?.length ?? 0) +
    (f.range?.length ?? 0) +
    (f.exists?.length ?? 0) +
    (f.available != null ? 1 : 0) +
    (f.jeopardy === true ? 1 : 0)
  );
}
