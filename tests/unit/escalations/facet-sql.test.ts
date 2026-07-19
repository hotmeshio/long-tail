import { describe, it, expect } from 'vitest';
import { buildFacetWhere, buildFacetOrder } from '../../../services/escalation/facet-sql';
import type { FacetQuery, FacetOrder } from '../../../types';

function where(q: FacetQuery): { clause: string; params: unknown[] } {
  const params: unknown[] = [];
  return { clause: buildFacetWhere(q, params), params };
}

describe('buildFacetWhere', () => {
  it('returns TRUE for empty query — no filter applied', () => {
    const { clause, params } = where({});
    expect(clause).toBe('TRUE');
    expect(params).toHaveLength(0);
  });

  it('filters by single role', () => {
    const { clause, params } = where({ role: 'reviewer' });
    expect(clause).toContain('role = $1');
    expect(params).toEqual(['reviewer']);
  });

  it('filters by roles array using ANY', () => {
    const { clause, params } = where({ roles: ['reviewer', 'grinder'] });
    expect(clause).toContain('ANY($1::text[])');
    expect(params[0]).toEqual(['reviewer', 'grinder']);
  });

  it('roles takes precedence over role when both set — only one predicate emitted', () => {
    // role and roles are mutually exclusive in buildFacetWhere (role checked first)
    const { clause } = where({ role: 'reviewer', roles: ['grinder'] });
    expect(clause).toContain('role = $1');
    expect(clause).not.toContain('ANY(');
  });

  it('filters by status', () => {
    const { clause, params } = where({ status: 'pending' });
    expect(clause).toContain('status = $1');
    expect(params).toEqual(['pending']);
  });

  it('facets metadata containment with @> (GIN-served)', () => {
    const { clause, params } = where({ facets: { station: 'qa', priority: 1 } });
    expect(clause).toContain('metadata @>');
    expect(params[0]).toBe(JSON.stringify({ station: 'qa', priority: 1 }));
  });

  it('block excludes rows matching any blocked metadata object', () => {
    const { clause, params } = where({ block: [{ cancelled: true }, { archived: true }] });
    expect(clause).toContain('NOT (metadata @> ANY(');
    expect((params[0] as string[]).length).toBe(2);
  });

  it('range with valid op adds a numeric metadata predicate', () => {
    const { clause, params } = where({ range: [{ facet: 'score', op: '>=', value: 80 }] });
    expect(clause).toContain("(metadata->>'score')::numeric >= $1");
    expect(params).toEqual([80]);
  });

  it('range with < op is accepted', () => {
    const { clause } = where({ range: [{ facet: 'age', op: '<', value: 30 }] });
    expect(clause).toContain('< $1');
  });

  it('range with invalid op is silently dropped — injection safety', () => {
    const { clause, params } = where({
      range: [{ facet: 'score', op: '; DROP TABLE lt_escalations--' as any, value: 1 }],
    });
    expect(clause).toBe('TRUE');
    expect(params).toHaveLength(0);
  });

  it('range with invalid facet key is dropped — injection safety', () => {
    const { clause, params } = where({
      range: [{ facet: "a b'; DROP TABLE--", op: '=', value: 1 }],
    });
    expect(clause).toBe('TRUE');
    expect(params).toHaveLength(0);
  });

  it('exists adds metadata key presence check', () => {
    const { clause } = where({ exists: ['order_id', 'batch'] });
    expect(clause).toContain("metadata ? 'order_id'");
    expect(clause).toContain("metadata ? 'batch'");
  });

  it('exists with invalid key containing special chars is dropped — injection safety', () => {
    const { clause, params } = where({ exists: ["'; DROP TABLE lt_escalations--"] });
    expect(clause).toBe('TRUE');
    expect(params).toHaveLength(0);
  });

  it('available=true constrains to unassigned or expired claims', () => {
    const { clause } = where({ available: true });
    expect(clause).toContain('assigned_to IS NULL OR assigned_until IS NULL OR assigned_until <= NOW()');
  });

  it('available=false constrains to actively claimed rows', () => {
    const { clause } = where({ available: false });
    expect(clause).toContain('assigned_to IS NOT NULL AND assigned_until > NOW()');
  });

  it('jeopardy=true adds the role-threshold age predicate (same expression as priority_count)', () => {
    const { clause, params } = where({ jeopardy: true });
    // Correlated on the role's dials with the same fallbacks as the pill count
    expect(clause).toContain('FROM lt_roles rt');
    expect(clause).toContain('rt.priority_facet');
    expect(clause).toContain('pg_input_is_valid');
    expect(clause).toContain('COALESCE(rt.priority_threshold_minutes, rt.sla_minutes)');
    // Outer row qualified so lt_roles.role never shadows it
    expect(clause).toContain('rt.role = lt_escalations.role');
    expect(clause).toContain('lt_escalations.created_at');
    // Pure SQL predicate — no bound params needed
    expect(params).toHaveLength(0);
  });

  it('jeopardy honors a custom outer table ref for hmsh callers', () => {
    const params: unknown[] = [];
    const clause = buildFacetWhere({ jeopardy: true }, params, { tableRef: 'e' });
    expect(clause).toContain('rt.role = e.role');
    expect(clause).toContain('e.created_at');
    expect(clause).not.toContain('lt_escalations.');
  });

  it('jeopardy composes with role and available (the pill deeplink shape)', () => {
    const { clause } = where({ role: 'intake-reviewer', available: true, jeopardy: true });
    const parts = clause.split('\n  AND ');
    expect(parts).toHaveLength(3);
    expect(clause).toContain('role = $1');
    expect(clause).toContain('assigned_to IS NULL');
    expect(clause).toContain('FROM lt_roles rt');
  });

  it('jeopardy absent emits no threshold clause', () => {
    expect(where({}).clause).not.toContain('lt_roles');
    expect(where({ available: true }).clause).not.toContain('lt_roles');
  });

  it('composes multiple clauses with AND', () => {
    const { clause, params } = where({ role: 'reviewer', status: 'pending', available: true });
    const parts = clause.split('\n  AND ');
    expect(parts.length).toBe(3);
    expect(clause).toContain('role = $1');
    expect(clause).toContain('status = $2');
    expect(params).toEqual(['reviewer', 'pending']);
  });

  it('multiple range predicates are all included', () => {
    const { clause } = where({
      range: [
        { facet: 'score', op: '>=', value: 80 },
        { facet: 'age', op: '<', value: 60 },
      ],
    });
    expect(clause).toContain("'score'");
    expect(clause).toContain("'age'");
  });
});

describe('buildFacetOrder', () => {
  it('returns default priority/created_at when no orderBy given', () => {
    expect(buildFacetOrder(undefined)).toBe('priority ASC, created_at ASC');
    expect(buildFacetOrder([])).toBe('priority ASC, created_at ASC');
  });

  it('orders by a whitelisted top-level column', () => {
    const result = buildFacetOrder([{ field: 'created_at', direction: 'desc' }]);
    expect(result).toBe('created_at DESC');
  });

  it('defaults direction to ASC when omitted', () => {
    const result = buildFacetOrder([{ field: 'priority' }]);
    expect(result).toBe('priority ASC');
  });

  it('orders by metadata key (text)', () => {
    const result = buildFacetOrder([{ field: 'metadata.station' }]);
    expect(result).toContain("metadata->>'station'");
    expect(result).toContain('NULLS LAST');
  });

  it('orders by metadata key as numeric when numeric=true', () => {
    const result = buildFacetOrder([{ field: 'metadata.score', numeric: true }]);
    expect(result).toContain("(metadata->>'score')::numeric");
  });

  it('drops metadata keys with invalid characters — injection safety', () => {
    const result = buildFacetOrder([{ field: "metadata.a'; DROP TABLE--" }]);
    expect(result).toBe('priority ASC, created_at ASC');
  });

  it('drops unknown top-level columns not in the whitelist', () => {
    const result = buildFacetOrder([{ field: 'resolver_payload' }]);
    expect(result).toBe('priority ASC, created_at ASC');
  });

  it('composes multiple order terms', () => {
    const result = buildFacetOrder([
      { field: 'priority', direction: 'asc' },
      { field: 'metadata.score', direction: 'desc', numeric: true },
    ]);
    expect(result).toContain('priority ASC');
    expect(result).toContain("(metadata->>'score')::numeric DESC");
  });
});
