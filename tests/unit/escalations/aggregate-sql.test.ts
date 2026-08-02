import { describe, it, expect } from 'vitest';
import {
  AnalyticsInputError,
  buildAggregateQuery,
  buildTimelineQuery,
} from '../../../services/escalation/aggregate-sql';
import type { AggregateByFacetsInput } from '../../../types';

const dwellWindow = {
  from: new Date(Date.now() - 3_600_000).toISOString(),
  to: new Date().toISOString(),
};

function membership(over: Partial<AggregateByFacetsInput> = {}): AggregateByFacetsInput {
  return { query: { roles: ['a'] }, groupBy: {}, measure: { kind: 'membership' }, ...over };
}

describe('buildAggregateQuery — membership', () => {
  it('now-anchored membership is the live set — same shape as the pace board counts', () => {
    const built = buildAggregateQuery(membership());
    expect(built.sql).toContain("status IN ('pending')");
    expect(built.sql).not.toContain('COALESCE(resolved_at, updated_at)');
    expect(built.nowAnchored).toBe(true);
  });

  it('a past asOf writes the branch-explicit overlap predicate (live OR ended-after)', () => {
    const built = buildAggregateQuery(
      membership({ measure: { kind: 'membership', asOf: new Date(Date.now() - 60_000) } }),
    );
    expect(built.sql).toMatch(/status IN \('pending'\) OR \(status NOT IN \('pending'\) AND COALESCE\(resolved_at, updated_at\) > \$\d+::timestamptz\)/);
    expect(built.nowAnchored).toBe(false);
  });

  it('inlines statuses as literals, never parameters, so the partial index predicate is provable', () => {
    const built = buildAggregateQuery(membership({ liveStatuses: ['pending', 'resolved'] }));
    expect(built.sql).toContain("status IN ('pending', 'resolved')");
    expect(built.params).not.toContain('pending');
  });

  it('distinctBy counts entities, not rows, and keeps sample_count beside it', () => {
    const built = buildAggregateQuery(membership({ distinctBy: 'serialNumber' }));
    expect(built.sql).toContain("count(DISTINCT (metadata->>'serialNumber'))::int");
    expect(built.sql).toContain('count(*)::int AS sample_count');
  });

  it('fetches pageLimit + 1 rows so overflow is detected, never silently truncated', () => {
    const built = buildAggregateQuery(membership({ limit: 10 }));
    expect(built.pageLimit).toBe(10);
    expect(built.params).toContain(11);
  });
});

describe('buildAggregateQuery — dwell', () => {
  it('clips each interval to the window and clamps open rows to NOW()', () => {
    const built = buildAggregateQuery(membership({ measure: { kind: 'dwell', window: dwellWindow } }));
    expect(built.sql).toMatch(/GREATEST\(created_at, \$\d+::timestamptz\) AS s/);
    expect(built.sql).toMatch(/LEAST\(COALESCE\(CASE WHEN status NOT IN \('pending'\) THEN COALESCE\(resolved_at, updated_at\) END, LEAST\(NOW\(\), \$\d+::timestamptz\)\), \$\d+::timestamptz\) AS e/);
    expect(built.sql).toContain('SUM(EXTRACT(EPOCH FROM (e - s)))::float8 AS dwell_seconds');
  });

  it('rejects distinctBy on dwell — a membership concept', () => {
    expect(() =>
      buildAggregateQuery(membership({ measure: { kind: 'dwell', window: dwellWindow }, distinctBy: 'serialNumber' })),
    ).toThrow(/membership concept/);
  });
});

describe('buildAggregateQuery — state grouping', () => {
  it('derives the state label per role source: subtype roles COALESCE, others are the role', () => {
    const built = buildAggregateQuery(membership({ groupBy: { state: true } }), {
      stateSources: { 'printer-fleet': 'subtype', 'printer-harvest': 'role' },
    });
    expect(built.sql).toContain(
      "CASE WHEN role IN ('printer-fleet') THEN COALESCE(subtype, role) ELSE role END AS state_label",
    );
    expect(built.stateGrouped).toBe(true);
  });

  it('all-role sources collapse to the bare role column', () => {
    const built = buildAggregateQuery(membership({ groupBy: { state: true } }), {
      stateSources: { 'printer-harvest': 'role' },
    });
    expect(built.sql).toContain('role AS state_label');
  });

  it('rejects state + states[] — two labeling mechanisms', () => {
    expect(() =>
      buildAggregateQuery(
        membership({ groupBy: { state: true }, states: [{ name: 'x', match: {} }] }),
        { stateSources: { a: 'role' } },
      ),
    ).toThrow(/two labeling mechanisms/);
  });

  it('rejects state grouping without a role scope', () => {
    expect(() => buildAggregateQuery(membership({ groupBy: { state: true } }))).toThrow(
      /requires a role scope/,
    );
  });

  it('rejects an unresolved query.entity — resolution must happen before SQL', () => {
    expect(() =>
      buildAggregateQuery({ query: { entity: 'serialNumber' }, groupBy: {}, measure: { kind: 'membership' } }),
    ).toThrow(/resolved to roles/);
  });
});

describe('buildTimelineQuery', () => {
  it('matches the entity GIN-served and orders by created_at with gaps preserved', () => {
    const built = buildTimelineQuery({ facet: { key: 'serialNumber', value: 'SN-1' } });
    expect(built.params[0]).toBe(JSON.stringify({ serialNumber: 'SN-1' }));
    expect(built.sql).toContain('metadata @> $1::jsonb');
    expect(built.sql).toContain('ORDER BY created_at ASC');
    expect(built.sql).toContain('AS duration_seconds');
  });

  it('rejects a non-string facet value — entity facets are stored as JSON strings', () => {
    expect(() => buildTimelineQuery({ facet: { key: 'serialNumber', value: '' } })).toThrow(
      /non-empty string/,
    );
    expect(() => buildTimelineQuery({ facet: { key: 'serialNumber', value: 7 as any } })).toThrow(
      AnalyticsInputError,
    );
  });

  it('a window overlap-filters (not clips) and clamps open durations to the window end', () => {
    const built = buildTimelineQuery({ facet: { key: 'serialNumber', value: 'SN-1' }, window: dwellWindow });
    expect(built.sql).toMatch(/created_at < \$\d+::timestamptz/);
    expect(built.sql).toMatch(/LEAST\(NOW\(\), \$\d+::timestamptz\)/);
  });
});
