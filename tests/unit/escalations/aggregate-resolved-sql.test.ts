import { describe, it, expect } from 'vitest';
import { AnalyticsInputError, buildAggregateQuery } from '../../../services/escalation/aggregate-sql';
import { resolveBucket } from '../../../services/escalation/aggregate-resolved-sql';
import type { AggregateByFacetsInput } from '../../../types';

const PAST = { from: '2026-10-01T00:00:00Z', to: '2026-11-01T00:00:00Z' };

function resolved(over: Partial<AggregateByFacetsInput> = {}, bucket?: 'day' | 'week' | 'month'): AggregateByFacetsInput {
  return {
    query: { role: 'intake-verifier' },
    groupBy: { facets: ['extractor', 'review_outcome'] },
    measure: { kind: 'resolved', window: PAST, ...(bucket ? { bucket } : {}) },
    ...over,
  };
}

describe('buildAggregateQuery: resolved', () => {
  it('counts resolved rows in the window with a literal status the partial index proves', () => {
    const built = buildAggregateQuery(resolved());
    expect(built.sql).toContain("status = 'resolved'");
    expect(built.sql).toMatch(/resolved_at >= \$\d+::timestamptz\s+AND resolved_at < \$\d+::timestamptz/);
    expect(built.sql).toContain('count(*)::int AS "count"');
    expect(built.params).not.toContain('resolved');
    expect(built.measureKind).toBe('resolved');
    expect(built.bucketed).toBe(false);
    expect(built.nowAnchored).toBe(false);
  });

  it('groups by a UTC calendar bucket and orders by it by default', () => {
    const built = buildAggregateQuery(resolved({}, 'week'));
    expect(built.sql).toContain("(date_trunc('week', resolved_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') AS bucket");
    expect(built.sql).toMatch(/GROUP BY bucket, "facet_extractor", "facet_review_outcome"/);
    expect(built.sql).toContain('ORDER BY bucket ASC, sample_count DESC');
    expect(built.bucketed).toBe(true);
  });

  it('orders by count, bucket or a grouped facet', () => {
    const built = buildAggregateQuery(resolved({
      orderBy: [{ field: 'bucket', direction: 'desc' }, { field: 'count', direction: 'desc' }, { field: 'extractor' }],
    }, 'day'));
    expect(built.sql).toContain('ORDER BY bucket DESC, "count" DESC, "facet_extractor" ASC NULLS LAST');
    expect(() => buildAggregateQuery(resolved({ orderBy: [{ field: 'dwellSeconds' }] }))).toThrow(AnalyticsInputError);
    expect(() => buildAggregateQuery(resolved({ orderBy: [{ field: 'bucket' }] }))).toThrow(/not a measure/);
  });

  it('counts distinct entities when asked', () => {
    const built = buildAggregateQuery(resolved({ distinctBy: 'applicationId' }));
    expect(built.sql).toContain(`count(DISTINCT (metadata->>'applicationId'))::int AS "count"`);
  });

  it('requires a role scope so it never sweeps every queue', () => {
    expect(() => buildAggregateQuery(resolved({ query: {} }))).toThrow(/requires a role scope/);
    expect(() => buildAggregateQuery(resolved({ query: { roles: ['a', 'b'] } }))).not.toThrow();
  });

  it('rejects liveStatuses and an unknown bucket', () => {
    expect(() => buildAggregateQuery(resolved({ liveStatuses: ['pending'] }))).toThrow(/liveStatuses/);
    expect(() => resolveBucket('year')).toThrow(/not one of day, week, month/);
    expect(resolveBucket(undefined)).toBeNull();
  });

  it('accepts a window past the dwell cap, up to the resolved cap', () => {
    const year = { from: '2025-11-01T00:00:00Z', to: '2026-11-01T00:00:00Z' };
    expect(() => buildAggregateQuery(resolved({ measure: { kind: 'resolved', window: year } }))).not.toThrow();
    const tooLong = { from: '2024-01-01T00:00:00Z', to: '2026-01-01T00:00:00Z' };
    expect(() => buildAggregateQuery(resolved({ measure: { kind: 'resolved', window: tooLong } })))
      .toThrow(/LT_ANALYTICS_MAX_RESOLVED_WINDOW_DAYS/);
  });

  it('is now-anchored while the window reaches now', () => {
    const live = { from: new Date(Date.now() - 86_400_000).toISOString(), to: new Date(Date.now() + 60_000).toISOString() };
    expect(buildAggregateQuery(resolved({ measure: { kind: 'resolved', window: live } })).nowAnchored).toBe(true);
  });
});
