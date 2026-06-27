import { describe, it, expect } from 'vitest';

import { buildFacetWhere, buildFacetOrder, buildGroupOrder } from '../../../services/escalation/facet-sql';
import type { FacetQuery } from '../../../types';

describe('buildFacetWhere', () => {
  it('builds containment, block, range, exists, role and status — all parameterized', () => {
    const params: unknown[] = [];
    const q: FacetQuery = {
      role: 'diabetic-print',
      status: 'pending',
      facets: { regulated: true },
      block: [{ hold: true }],
      range: [{ facet: 'size', op: '<=', value: 13 }],
      exists: ['customerId'],
      available: true,
    };
    const where = buildFacetWhere(q, params);
    expect(where).toContain('role = $1');
    expect(where).toContain('status = $2');
    expect(where).toContain('metadata @> $3::jsonb');         // GIN containment
    expect(where).toContain('NOT (metadata @> ANY($4::jsonb[]))');
    expect(where).toContain("(metadata->>'size')::numeric <= $5");
    expect(where).toContain("metadata ? 'customerId'");
    expect(where).toContain('assigned_until <= NOW()');        // available
    expect(params).toEqual(['diabetic-print', 'pending', '{"regulated":true}', ['{"hold":true}'], 13]);
  });

  it('supports roles[] and held-now (available=false)', () => {
    const params: unknown[] = [];
    const where = buildFacetWhere({ roles: ['a', 'b'], available: false }, params);
    expect(where).toContain('role = ANY($1::text[])');
    expect(where).toContain('assigned_to IS NOT NULL AND assigned_until > NOW()');
    expect(params).toEqual([['a', 'b']]);
  });

  it('drops injection attempts in range facet keys and operators (no params leaked)', () => {
    const params: unknown[] = [];
    const where = buildFacetWhere(
      { range: [{ facet: "size'; DROP TABLE x; --", op: '<=', value: 1 }, { facet: 'ok', op: 'BAD' as any, value: 2 }] },
      params,
    );
    expect(where).toBe('TRUE');     // both dropped (bad key, bad op)
    expect(params).toEqual([]);
  });

  it('returns TRUE for an empty query', () => {
    const params: unknown[] = [];
    expect(buildFacetWhere({}, params)).toBe('TRUE');
    expect(params).toEqual([]);
  });
});

describe('buildFacetOrder', () => {
  it('mixes top-level columns and metadata facets, numeric and text', () => {
    const order = buildFacetOrder([
      { field: 'priority', direction: 'asc' },
      { field: 'metadata.dueDate' },
      { field: 'metadata.size', numeric: true, direction: 'desc' },
    ]);
    expect(order).toBe("priority ASC, (metadata->>'dueDate') ASC NULLS LAST, (metadata->>'size')::numeric DESC NULLS LAST");
  });

  it('skips unknown/invalid fields and falls back to the default', () => {
    expect(buildFacetOrder([{ field: 'evil; DROP' }])).toBe('priority ASC, created_at ASC');
    expect(buildFacetOrder([])).toBe('priority ASC, created_at ASC');
    expect(buildFacetOrder(undefined)).toBe('priority ASC, created_at ASC');
  });
});

describe('buildGroupOrder', () => {
  it('aggregates each key (min asc / max desc) for a stable order over orders', () => {
    const order = buildGroupOrder([
      { field: 'priority', direction: 'asc' },
      { field: 'metadata.dueDate', direction: 'desc' },
    ]);
    expect(order).toBe("min(priority) ASC, max((metadata->>'dueDate')) DESC NULLS LAST");
  });

  it('defaults to natural priority/FIFO group order', () => {
    expect(buildGroupOrder(undefined)).toBe('min(priority) ASC, min(created_at) ASC');
  });
});
