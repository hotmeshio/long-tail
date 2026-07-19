import { describe, it, expect } from 'vitest';
import { parseFacetParams, writeFacetParams, facetCount } from '../facet-url';

describe('facet-url — deep-link round-trip', () => {
  it('round-trips a full faceted query through URL params', () => {
    const q = {
      facets: { confidence: 0.65 },
      range: [{ facet: 'size', op: '<=' as const, value: 13 }],
      exists: ['needsReview'],
      block: [{ outcome: 'success' }],
      orderBy: [{ field: 'metadata.confidence', numeric: true, direction: 'asc' as const }],
      available: true,
    };
    const p = new URLSearchParams();
    writeFacetParams(p, q);
    expect(p.get('facets')).toBe(JSON.stringify({ confidence: 0.65 }));
    expect(p.get('available')).toBe('true');
    expect(parseFacetParams(p)).toEqual(q);
  });

  it('omits empty elements from the URL (clean links)', () => {
    const p = new URLSearchParams();
    writeFacetParams(p, { facets: {}, range: [], exists: [] });
    expect(p.toString()).toBe('');
  });

  it('preserves non-facet params (coexists with useFilterParams)', () => {
    const p = new URLSearchParams('role=reviewer&page=2');
    writeFacetParams(p, { facets: { a: 1 } });
    expect(p.get('role')).toBe('reviewer');
    expect(p.get('page')).toBe('2');
    expect(parseFacetParams(p)).toEqual({ facets: { a: 1 } });
  });

  it('counts active facet conditions for the trigger badge', () => {
    expect(facetCount({ facets: { a: 1, b: 2 }, range: [{ facet: 'x', op: '<', value: 1 }] })).toBe(3);
    expect(facetCount({})).toBe(0);
  });

  it('round-trips the jeopardy filter as jeopardy=1', () => {
    const p = new URLSearchParams();
    writeFacetParams(p, { jeopardy: true });
    expect(p.get('jeopardy')).toBe('1');
    expect(parseFacetParams(p)).toEqual({ jeopardy: true });

    // Clearing it removes the param entirely
    writeFacetParams(p, {});
    expect(p.get('jeopardy')).toBeNull();
  });

  it('accepts jeopardy=true as an equivalent hand-typed form', () => {
    expect(parseFacetParams(new URLSearchParams('jeopardy=true'))).toEqual({ jeopardy: true });
  });

  it('jeopardy counts as a condition; orderBy never does (sort reorders, it does not narrow)', () => {
    expect(facetCount({ jeopardy: true })).toBe(1);
    expect(facetCount({ orderBy: [{ field: 'created_at', direction: 'asc' }] })).toBe(0);
    expect(facetCount({ jeopardy: true, orderBy: [{ field: 'metadata.authorized_at', direction: 'asc' }] })).toBe(1);
  });
});
