import { describe, it, expect } from 'vitest';
import { buildFacetWhere } from '../../../services/escalation/facet-sql';
import type { FacetQuery } from '../../../types';

function where(q: FacetQuery): { clause: string; params: unknown[] } {
  const params: unknown[] = [];
  return { clause: buildFacetWhere(q, params), params };
}

// The two scale predicates: locate by value prefix, and target an explicit
// entity set — both composing into scans the rest of the filter bounds.

describe('buildFacetWhere — prefix', () => {
  it('emits a case-insensitive prefix match on the facet value', () => {
    const { clause, params } = where({ prefix: { serialNumber: 'PRN-0' } });
    expect(clause).toContain(`(metadata->>'serialNumber') ILIKE $1`);
    expect(params).toEqual(['PRN-0%']);
  });

  it('escapes LIKE wildcards so the value matches literally', () => {
    const { params } = where({ prefix: { serialNumber: 'A%B_C\\D' } });
    expect(params).toEqual(['A\\%B\\_C\\\\D%']);
  });

  it('skips malformed keys and empty values (the analytics layer rejects them loudly first)', () => {
    const { clause } = where({ prefix: { 'bad key': 'x', serialNumber: '' } });
    expect(clause).toBe('TRUE');
  });

  it('composes with the rest of the filter', () => {
    const { clause } = where({ roles: ['a'], prefix: { serialNumber: 'PRN' } });
    expect(clause).toContain('role = ANY($1::text[])');
    expect(clause).toContain('ILIKE $2');
  });
});

describe('buildFacetWhere — anyOf', () => {
  it('emits the positive ANY-containment (the mirror of block), GIN-served', () => {
    const { clause, params } = where({
      anyOf: [{ serialNumber: 'PRN-001' }, { serialNumber: 'PRN-002' }],
    });
    expect(clause).toContain('metadata @> ANY($1::jsonb[])');
    expect(clause).not.toContain('NOT');
    expect(params[0]).toEqual([
      JSON.stringify({ serialNumber: 'PRN-001' }),
      JSON.stringify({ serialNumber: 'PRN-002' }),
    ]);
  });

  it('anyOf and block coexist as independent predicates', () => {
    const { clause } = where({
      anyOf: [{ serialNumber: 'PRN-001' }],
      block: [{ archived: true }],
    });
    expect(clause).toContain('metadata @> ANY($1::jsonb[])');
    expect(clause).toContain('NOT (metadata @> ANY($2::jsonb[]))');
  });
});
