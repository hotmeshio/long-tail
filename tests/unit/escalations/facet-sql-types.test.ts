import { describe, it, expect } from 'vitest';

import { buildFacetWhere } from '../../../services/escalation/facet-sql';
import type { FacetQuery } from '../../../types';

function where(q: FacetQuery): { clause: string; params: unknown[] } {
  const params: unknown[] = [];
  return { clause: buildFacetWhere(q, params), params };
}

describe('buildFacetWhere types and subtypes', () => {
  it('filters by types with ANY', () => {
    const { clause, params } = where({ types: ['matchBox'] });
    expect(clause).toBe('type = ANY($1::text[])');
    expect(params).toEqual([['matchBox']]);
  });

  it('filters by subtypes with ANY', () => {
    const { clause, params } = where({ subtypes: ['box', 'crate'] });
    expect(clause).toBe('subtype = ANY($1::text[])');
    expect(params).toEqual([['box', 'crate']]);
  });

  it('composes with role and facets in parameter order', () => {
    const { clause, params } = where({ role: 'match-filling', types: ['matchBox'], subtypes: ['box'], facets: { boxKey: 'B1' } });
    expect(clause.replace(/\s+/g, ' ')).toBe('role = $1 AND type = ANY($2::text[]) AND subtype = ANY($3::text[]) AND metadata @> $4::jsonb');
    expect(params).toEqual(['match-filling', ['matchBox'], ['box'], JSON.stringify({ boxKey: 'B1' })]);
  });

  it('empty arrays add no predicate', () => {
    expect(where({ types: [], subtypes: [] }).clause).toBe('TRUE');
  });
});
